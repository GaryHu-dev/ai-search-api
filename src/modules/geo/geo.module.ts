import { Module } from '@nestjs/common';
import { JobsModule } from '../../core/jobs/jobs.module';
import { AuditRunner } from './audit-runner';
import { SiteAuditsController } from './audits.controller';
import { SiteAuditsService } from './audits.service';
import { GeoAuditWorker } from './geo-audit.worker';
import { PageFetcher } from './page-fetcher';

@Module({
  imports: [JobsModule],
  controllers: [SiteAuditsController],
  providers: [SiteAuditsService, AuditRunner, PageFetcher, GeoAuditWorker],
})
export class GeoModule {}
