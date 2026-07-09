import { Module } from '@nestjs/common';
import { JobsModule } from '../../core/jobs/jobs.module';
import { AuditRunner } from './audit-runner';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { GeoAuditWorker } from './geo-audit.worker';
import { PageFetcher } from './page-fetcher';

@Module({
  imports: [JobsModule],
  controllers: [AuditsController],
  providers: [AuditsService, AuditRunner, PageFetcher, GeoAuditWorker],
})
export class GeoModule {}
