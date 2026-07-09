import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import PgBoss from 'pg-boss';
import { JobsService } from '../../core/jobs/jobs.service';
import {
  TENANT_PRISMA,
  TenantPrismaClient,
} from '../../core/prisma/prisma.module';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { AuditRunner } from './audit-runner';
import { GEO_AUDIT_QUEUE, GeoAuditJobData } from './geo.constants';

@Injectable()
export class GeoAuditWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(GeoAuditWorker.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly runner: AuditRunner,
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
  ) {}

  // Registered on bootstrap, after JobsService starts pg-boss on module init.
  async onApplicationBootstrap(): Promise<void> {
    const boss = this.jobs.client;
    await boss.createQueue(GEO_AUDIT_QUEUE);
    // pg-boss delivers a batch (size 1 by default); handle each defensively.
    await boss.work<GeoAuditJobData>(GEO_AUDIT_QUEUE, async (jobs) => {
      for (const job of jobs) await this.handle(job);
    });
  }

  private async handle(job: PgBoss.Job<GeoAuditJobData>): Promise<void> {
    const { auditId, tenantId } = job.data;
    // The tenant-scope extension fails closed, so all Audit access runs in context.
    await TenantContext.run(tenantId, async () => {
      // Claim the audit atomically: only one worker moves it PENDING -> PROCESSING,
      // so a redelivery or duplicate worker can't run it twice.
      const claimed = await this.prisma.audit.updateMany({
        where: { id: auditId, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
      if (claimed.count === 0) return;

      const audit = await this.prisma.audit.findFirst({
        where: { id: auditId },
      });
      if (!audit) return;

      try {
        const findings = await this.runner.run(audit.url);
        await this.prisma.audit.update({
          where: { id: auditId },
          data: { status: 'COMPLETED', findings, fetchedAt: new Date() },
        });
      } catch (err) {
        this.logger.error(
          `Audit ${auditId} failed`,
          err instanceof Error ? err.stack : err,
        );
        await this.prisma.audit.update({
          where: { id: auditId },
          data: {
            status: 'FAILED',
            error: err instanceof Error ? err.message : 'Audit failed',
            fetchedAt: new Date(),
          },
        });
      }
    });
  }
}
