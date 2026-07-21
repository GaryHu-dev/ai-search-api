import { SiteAuditsService } from '../audits.service';
import { GEO_AUDIT_QUEUE } from '../geo.constants';

describe('SiteAuditsService', () => {
  const prisma = {
    siteAudit: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
  const enqueue = jest.fn();
  const jobs = { enqueue };

  const service = new SiteAuditsService(prisma as never, jobs as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a PENDING audit and enqueues a job', async () => {
    prisma.siteAudit.count.mockResolvedValue(0);
    prisma.siteAudit.create.mockResolvedValue({
      id: 'a1',
      tenantId: 't1',
      status: 'PENDING',
    });

    const audit = await service.create('https://x.com', 'u1', 't1');

    expect(prisma.siteAudit.create).toHaveBeenCalledWith({
      data: { url: 'https://x.com', requestedById: 'u1', tenantId: 't1' },
    });
    expect(enqueue).toHaveBeenCalledWith(
      GEO_AUDIT_QUEUE,
      { auditId: 'a1', tenantId: 't1' },
      expect.any(Object),
    );
    expect(audit.id).toBe('a1');
  });

  it('marks the audit FAILED if enqueue throws (no PENDING orphan)', async () => {
    prisma.siteAudit.count.mockResolvedValue(0);
    prisma.siteAudit.create.mockResolvedValue({ id: 'a1', tenantId: 't1' });
    enqueue.mockRejectedValue(new Error('queue down'));

    await expect(service.create('https://x.com', 'u1', 't1')).rejects.toThrow();
    expect(prisma.siteAudit.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'FAILED', error: 'Could not queue the audit' },
    });
  });

  it('rejects with 429 when the tenant has too many in-flight audits', async () => {
    prisma.siteAudit.count.mockResolvedValue(5);

    await expect(
      service.create('https://x.com', 'u1', 't1'),
    ).rejects.toMatchObject({ status: 429 });
    expect(prisma.siteAudit.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('throws NotFound when an audit is not in the tenant', async () => {
    prisma.siteAudit.findFirst.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow('Audit not found');
  });
});
