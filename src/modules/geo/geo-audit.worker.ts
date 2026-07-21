import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { JobsService } from '../../core/jobs/jobs.service';
import {
  TENANT_PRISMA,
  TenantPrismaClient,
} from '../../core/prisma/prisma.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { AuditRunner } from './audit-runner';
import {
  GEO_AUDIT_QUEUE,
  GEO_PURGE_QUEUE,
  GEO_REAP_QUEUE,
  GeoAuditJobData,
} from './geo.constants';

// An audit run should finish in seconds. Anything still PENDING (created but
// never claimed) or PROCESSING (claimed but the worker died mid-run) past this
// window is stuck — the reaper fails it so the client stops polling forever.
// Kept well above the audit job's expireInSeconds (300s) so pg-boss expiry and
// the reaper don't race a still-running audit.
const STALE_PROCESSING_MS = 15 * 60 * 1000;

// Audits (and the scraped third-party content in their findings) are retained
// for this long, then purged.
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

@Injectable()
export class GeoAuditWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(GeoAuditWorker.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly runner: AuditRunner,
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    // Plain client for the cross-tenant reaper (a system sweep, not request-scoped).
    private readonly db: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.registerWorker<GeoAuditJobData>(GEO_AUDIT_QUEUE, (data) =>
      this.handle(data),
    );
    // Recover audits left stuck in PROCESSING by a crashed worker.
    await this.jobs.registerWorker(GEO_REAP_QUEUE, () => this.reapStale());
    await this.jobs.registerSchedule(GEO_REAP_QUEUE, '*/5 * * * *');
    // Retention: delete audits (and their scraped content) past the window.
    await this.jobs.registerWorker(GEO_PURGE_QUEUE, () => this.purgeOld());
    await this.jobs.registerSchedule(GEO_PURGE_QUEUE, '0 4 * * *');
  }

  private async handle(data: GeoAuditJobData): Promise<void> {
    const { auditId, tenantId } = data;
    // The tenant-scope extension fails closed, so all Audit access runs in context.
    await TenantContext.run(tenantId, async () => {
      // Claim the audit atomically: only one worker moves it PENDING -> PROCESSING,
      // so a redelivery or duplicate worker can't run it twice.
      const claimed = await this.prisma.siteAudit.updateMany({
        where: { id: auditId, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
      if (claimed.count === 0) return;

      const audit = await this.prisma.siteAudit.findFirst({
        where: { id: auditId },
      });
      if (!audit) return;

      // The completion writes guard on status: 'PROCESSING'. If the reaper has
      // already flipped this row to FAILED (a slow/stalled run), we must not
      // resurrect it to COMPLETED/FAILED with fresh data. On success we also
      // clear any stale error left by a prior attempt.
      try {
        const findings = await this.runner.run(audit.url);
        await this.prisma.siteAudit.updateMany({
          where: { id: auditId, status: 'PROCESSING' },
          data: {
            status: 'COMPLETED',
            findings,
            error: null,
            fetchedAt: new Date(),
          },
        });
      } catch (err) {
        this.logger.error(
          `Audit ${auditId} failed`,
          err instanceof Error ? err.stack : err,
        );
        await this.prisma.siteAudit.updateMany({
          where: { id: auditId, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            error: err instanceof Error ? err.message : 'Audit failed',
            fetchedAt: new Date(),
          },
        });
      }
    });
  }

  // Cross-tenant sweep: fail audits stuck in PROCESSING past the threshold. Uses
  // the plain client because it spans tenants (a maintenance task, not a request).
  private async reapStale(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
    // Covers a worker that died mid-run (PROCESSING) AND an audit that was
    // created but never enqueued/claimed (a PENDING orphan from a crash between
    // create and enqueue). updatedAt equals createdAt until the claim, so the
    // one cutoff catches both.
    const { count } = await this.db.siteAudit.updateMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        updatedAt: { lt: cutoff },
      },
      data: { status: 'FAILED', error: 'Audit timed out' },
    });
    if (count > 0) this.logger.warn(`Reaped ${count} stalled audit(s)`);
  }

  // Cross-tenant retention sweep: remove audits past the retention window.
  private async purgeOld(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const { count } = await this.db.siteAudit.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) this.logger.log(`Purged ${count} old audit(s)`);
  }
}
