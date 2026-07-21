import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { RefreshTokenCleanupJob } from './refresh-token-cleanup.job';

// Background processing. JobsService owns the pg-boss connection; each job class
// registers its own queue, worker, and schedule on startup. Core jobs are added
// as providers here; JobsService is exported so feature modules can enqueue and
// run their own workers (e.g. the GEO audit worker).
@Module({
  providers: [JobsService, RefreshTokenCleanupJob],
  exports: [JobsService],
})
export class JobsModule {}
