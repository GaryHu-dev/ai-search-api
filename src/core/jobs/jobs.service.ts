import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import { Env } from '../config/env.validation';

// Owns the pg-boss lifecycle and is the ONLY place that touches the vendor API,
// so features enqueue work and register workers through a small typed surface
// instead of re-deriving the "register after start" timing rule each time.
//
// pg-boss keeps its queues in the same PostgreSQL database, so background
// processing needs no extra infrastructure (no Redis). Workers run in-process,
// which is right at our current scale.
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly boss: PgBoss;
  private started = false;

  constructor(config: ConfigService<Env, true>) {
    this.boss = new PgBoss({
      connectionString: config.get('DATABASE_URL', { infer: true }),
    });
    this.boss.on('error', (error) =>
      this.logger.error(
        'pg-boss error',
        error instanceof Error ? error.stack : error,
      ),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    this.started = true;
  }

  async onModuleDestroy(): Promise<void> {
    this.started = false;
    await this.boss.stop();
  }

  // Whether pg-boss has started (and not been stopped) — used by the readiness
  // probe. A dropped DB connection is separately caught by the Prisma ping.
  isHealthy(): boolean {
    return this.started;
  }

  // Enqueue a job. retryLimit/expireInSeconds default sensibly; a slow job (the
  // GEO audit) can raise expireInSeconds so pg-boss doesn't reclaim it mid-run.
  async enqueue<T extends object>(
    queue: string,
    data: T,
    options: { retryLimit?: number; expireInSeconds?: number } = {},
  ): Promise<void> {
    await this.boss.send(queue, data, {
      retryLimit: options.retryLimit ?? 2,
      expireInSeconds: options.expireInSeconds ?? 120,
    });
  }

  // Register a queue + its worker. MUST be called from a provider's
  // onApplicationBootstrap: that runs after this service starts pg-boss in
  // onModuleInit, so the queue/worker registration can't race the schema
  // creation. Keeping that rule here means feature workers never repeat it.
  async registerWorker<T extends object = object>(
    queue: string,
    handler: (data: T) => Promise<void>,
  ): Promise<void> {
    await this.boss.createQueue(queue);
    await this.boss.work<T>(queue, async (jobs) => {
      await Promise.all(jobs.map((job) => handler(job.data)));
    });
  }

  // Schedule a recurring fire onto a queue (idempotent on queue+cron). The queue
  // must have a worker registered via registerWorker to process the fires.
  async registerSchedule(queue: string, cron: string): Promise<void> {
    await this.boss.schedule(queue, cron);
  }
}
