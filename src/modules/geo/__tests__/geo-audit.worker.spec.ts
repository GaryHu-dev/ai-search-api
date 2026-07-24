import { GeoAuditWorker } from '../geo-audit.worker';
import {
  GEO_AUDIT_QUEUE,
  GEO_PURGE_QUEUE,
  GEO_REAP_QUEUE,
  GeoAuditJobData,
} from '../geo.constants';

// The worker registers its private handlers via JobsService.registerWorker in
// onApplicationBootstrap, so the tests capture those callbacks from the mock
// and invoke them directly to exercise the reaper, the purge sweep, and the
// completion "resurrection guard".
describe('GeoAuditWorker', () => {
  const db = {
    siteAudit: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const prisma = {
    siteAudit: {
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const runner = { run: jest.fn() };
  const notifications = { notify: jest.fn() };
  const jobs = {
    registerWorker: jest.fn(),
    registerSchedule: jest.fn(),
  };

  let worker: GeoAuditWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    notifications.notify.mockResolvedValue({ id: 'notif1' });
    worker = new GeoAuditWorker(
      jobs as never,
      runner as never,
      prisma as never,
      db as never,
      notifications as never,
    );
    await worker.onApplicationBootstrap();
  });

  // Pulls the handler a given queue was registered with, so the test can
  // invoke the worker's private logic without reaching into internals.
  function handlerFor(queue: string): (data?: unknown) => Promise<void> {
    const call = jobs.registerWorker.mock.calls.find(
      ([q]: [string]) => q === queue,
    );
    if (!call) throw new Error(`no worker registered for queue ${queue}`);
    return call[1] as (data?: unknown) => Promise<void>;
  }

  describe('reapStale', () => {
    it('flips a stale row to FAILED and notifies its requester', async () => {
      const stale = {
        id: 'a1',
        tenantId: 't1',
        requestedById: 'u1',
        url: 'https://stale.test',
      };
      db.siteAudit.findMany.mockResolvedValue([stale]);
      db.siteAudit.updateMany.mockResolvedValue({ count: 1 });

      const reap = handlerFor(GEO_REAP_QUEUE);
      await reap();

      expect(db.siteAudit.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['PENDING', 'PROCESSING'] },
          updatedAt: { lt: expect.any(Date) },
        },
        select: { id: true, tenantId: true, requestedById: true, url: true },
      });
      expect(db.siteAudit.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'a1',
          status: { in: ['PENDING', 'PROCESSING'] },
          updatedAt: { lt: expect.any(Date) },
        },
        data: { status: 'FAILED', error: 'Audit timed out' },
      });
      expect(notifications.notify).toHaveBeenCalledWith({
        userId: 'u1',
        tenantId: 't1',
        type: 'audit.failed',
        title: 'Audit failed',
        body: 'Your audit of https://stale.test could not be completed.',
        data: { auditId: 'a1' },
      });
    });

    it('does not touch or notify a row absent from the stale candidates', async () => {
      db.siteAudit.findMany.mockResolvedValue([]);

      const reap = handlerFor(GEO_REAP_QUEUE);
      await reap();

      expect(db.siteAudit.updateMany).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not notify a candidate the guarded update no longer flips (already resolved)', async () => {
      const resolvedInTheMeantime = {
        id: 'a2',
        tenantId: 't1',
        requestedById: 'u1',
        url: 'https://fresh.test',
      };
      db.siteAudit.findMany.mockResolvedValue([resolvedInTheMeantime]);
      // The row was a candidate at findMany time, but the per-row guarded
      // updateMany finds it no longer matches (count 0) — e.g. the audit
      // worker completed it between the findMany and this updateMany.
      db.siteAudit.updateMany.mockResolvedValue({ count: 0 });

      const reap = handlerFor(GEO_REAP_QUEUE);
      await reap();

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('is best-effort: a notify failure does not throw or abort the sweep', async () => {
      const staleA = {
        id: 'a3',
        tenantId: 't1',
        requestedById: 'u1',
        url: 'https://stale-a.test',
      };
      const staleB = {
        id: 'a4',
        tenantId: 't2',
        requestedById: 'u2',
        url: 'https://stale-b.test',
      };
      db.siteAudit.findMany.mockResolvedValue([staleA, staleB]);
      db.siteAudit.updateMany.mockResolvedValue({ count: 1 });
      notifications.notify
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ id: 'notif2' });

      const reap = handlerFor(GEO_REAP_QUEUE);
      await expect(reap()).resolves.toBeUndefined();

      // The second candidate is still processed after the first's notify threw.
      expect(notifications.notify).toHaveBeenCalledTimes(2);
      expect(db.siteAudit.updateMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('purgeOld', () => {
    it('deletes audits past the retention cutoff', async () => {
      db.siteAudit.deleteMany.mockResolvedValue({ count: 3 });

      const purge = handlerFor(GEO_PURGE_QUEUE);
      await purge();

      expect(db.siteAudit.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expect.any(Date) } },
      });
    });

    it('does nothing (no log-worthy sweep) when nothing is past retention', async () => {
      db.siteAudit.deleteMany.mockResolvedValue({ count: 0 });

      const purge = handlerFor(GEO_PURGE_QUEUE);
      await expect(purge()).resolves.toBeUndefined();
    });
  });

  describe('completion resurrection guard', () => {
    const data: GeoAuditJobData = { auditId: 'a1', tenantId: 't1' };

    it('completes and notifies normally when the row is still PROCESSING', async () => {
      prisma.siteAudit.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim PENDING -> PROCESSING
        .mockResolvedValueOnce({ count: 1 }); // completion write succeeds
      prisma.siteAudit.findFirst.mockResolvedValue({
        id: 'a1',
        tenantId: 't1',
        requestedById: 'u1',
        url: 'https://x.test',
      });
      runner.run.mockResolvedValue([{ dimension: 'core-metadata' }]);

      const handle = handlerFor(GEO_AUDIT_QUEUE);
      await handle(data);

      expect(prisma.siteAudit.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'a1', status: 'PROCESSING' },
        data: {
          status: 'COMPLETED',
          findings: [{ dimension: 'core-metadata' }],
          error: null,
          fetchedAt: expect.any(Date),
        },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'audit.completed' }),
      );
    });

    it('withholds COMPLETED and the notification when the reaper already flipped the row', async () => {
      prisma.siteAudit.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim PENDING -> PROCESSING
        .mockResolvedValueOnce({ count: 0 }); // reaper won: row no longer PROCESSING
      prisma.siteAudit.findFirst.mockResolvedValue({
        id: 'a1',
        tenantId: 't1',
        requestedById: 'u1',
        url: 'https://x.test',
      });
      runner.run.mockResolvedValue([]);

      const handle = handlerFor(GEO_AUDIT_QUEUE);
      await handle(data);

      expect(prisma.siteAudit.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'a1', status: 'PROCESSING' },
        data: {
          status: 'COMPLETED',
          findings: [],
          error: null,
          fetchedAt: expect.any(Date),
        },
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
