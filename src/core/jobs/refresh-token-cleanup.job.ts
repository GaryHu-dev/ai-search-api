import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from './jobs.service';

const QUEUE = 'refresh-tokens.purge';

// Housekeeping: refresh tokens accumulate as users log in and out. Expired ones,
// and revoked ones past a short grace window, are removed on a daily schedule.
@Injectable()
export class RefreshTokenCleanupJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(RefreshTokenCleanupJob.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  // Registered on bootstrap (JobsService guarantees pg-boss has started by then).
  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.registerWorker(QUEUE, async () => {
      await this.purgeStale();
    });
    // Daily at 03:00 UTC. Scheduling is idempotent on (queue, cron).
    await this.jobs.registerSchedule(QUEUE, '0 3 * * *');
  }

  // Public so it can be invoked directly in tests without waiting for the cron.
  async purgeStale(): Promise<number> {
    // Keep revoked tokens for a short window so reuse-detection still has
    // something to catch; drop anything expired outright.
    const revokedGrace = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: revokedGrace } },
        ],
      },
    });

    if (count > 0) {
      this.logger.log(`Purged ${count} stale refresh token(s)`);
    }
    return count;
  }
}
