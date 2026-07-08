import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { RefreshTokenCleanupJob } from './refresh-token-cleanup.job';

// Background processing. JobsService owns the pg-boss connection; each job class
// registers its own queue, worker, and schedule on startup. New jobs are added
// as providers here.
@Module({
  providers: [JobsService, RefreshTokenCleanupJob],
})
export class JobsModule {}
