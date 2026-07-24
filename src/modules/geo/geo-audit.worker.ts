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
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
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
        const done = await this.prisma.siteAudit.updateMany({
          where: { id: auditId, status: 'PROCESSING' },
          data: {
            status: 'COMPLETED',
            findings,
            error: null,
            fetchedAt: new Date(),
          },
        });
        if (done.count > 0) {
          await this.notifyAudit(audit, 'COMPLETED');
        }
      } catch (err) {
        this.logger.error(
          `Audit ${auditId} failed`,
          err instanceof Error ? err.stack : err,
        );
        const failed = await this.prisma.siteAudit.updateMany({
          where: { id: auditId, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            error: err instanceof Error ? err.message : 'Audit failed',
            fetchedAt: new Date(),
          },
        });
        if (failed.count > 0) {
          await this.notifyAudit(audit, 'FAILED');
        }
      }
    });
  }

  // Best-effort: a notification failure must not fail the audit, which is
  // already persisted. Runs inside the handler's TenantContext, and passes
  // tenantId explicitly, so the notification is correctly tenant/user-scoped.
  private async notifyAudit(
    audit: { id: string; url: string; tenantId: string; requestedById: string },
    status: 'COMPLETED' | 'FAILED',
  ): Promise<void> {
    try {
      await this.notifications.notify({
        userId: audit.requestedById,
        tenantId: audit.tenantId,
        type: status === 'COMPLETED' ? 'audit.completed' : 'audit.failed',
        title: status === 'COMPLETED' ? 'Audit complete' : 'Audit failed',
        body:
          status === 'COMPLETED'
            ? `Your audit of ${audit.url} is ready.`
            : `Your audit of ${audit.url} could not be completed.`,
        data: { auditId: audit.id },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create notification for audit ${audit.id}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // Cross-tenant sweep: fail audits stuck in PROCESSING past the threshold. Uses
  // the plain client because it spans tenants (a maintenance task, not a request).
  private async reapStale(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
    // Covers a worker that died mid-run (PROCESSING) AND an audit that was
    // created but never enqueued/claimed (a PENDING orphan from a crash between
    // create and enqueue). updatedAt equals createdAt until the claim, so the
    // one cutoff catches both.
    const candidates = await this.db.siteAudit.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, tenantId: true, requestedById: true, url: true },
    });

    let reaped = 0;
    for (const row of candidates) {
      // Guarded transition, re-checked per row: only flip (and notify) a row
      // still stale at this instant, so one the worker completed in the
      // meantime between the findMany above and here isn't resurrected.
      const { count } = await this.db.siteAudit.updateMany({
        where: {
          id: row.id,
          status: { in: ['PENDING', 'PROCESSING'] },
          updatedAt: { lt: cutoff },
        },
        data: { status: 'FAILED', error: 'Audit timed out' },
      });
      if (count === 0) continue;
      reaped++;
      // Best-effort, same as notifyAudit's own try/catch: a notification
      // failure must not break the reaper loop for the remaining candidates.
      await TenantContext.run(row.tenantId, () =>
        this.notifyAudit(row, 'FAILED'),
      );
    }
    if (reaped > 0) this.logger.warn(`Reaped ${reaped} stalled audit(s)`);
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
