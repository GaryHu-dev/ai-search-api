import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import { Env } from '../config/env.validation';

// Owns the pg-boss lifecycle. pg-boss keeps its queues in the same PostgreSQL
// database, so background processing needs no extra infrastructure (no Redis).
//
// Workers run in-process here, which is right at our current scale. If job
// volume ever competes with request handling, the same queues can be drained by
// a separate worker process without changing how jobs are enqueued.
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly boss: PgBoss;

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
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss.stop();
  }

  get client(): PgBoss {
    return this.boss;
  }
}
