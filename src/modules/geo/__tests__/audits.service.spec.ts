import { AuditsService } from '../audits.service';
import { GEO_AUDIT_QUEUE } from '../geo.constants';

describe('AuditsService', () => {
  const prisma = {
    audit: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const send = jest.fn();
  const jobs = { client: { send } };

  const service = new AuditsService(prisma as never, jobs as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a PENDING audit and enqueues a job', async () => {
    prisma.audit.create.mockResolvedValue({
      id: 'a1',
      tenantId: 't1',
      status: 'PENDING',
    });

    const audit = await service.create('https://x.com', 'u1', 't1');

    expect(prisma.audit.create).toHaveBeenCalledWith({
      data: { url: 'https://x.com', requestedById: 'u1', tenantId: 't1' },
    });
    expect(send).toHaveBeenCalledWith(GEO_AUDIT_QUEUE, {
      auditId: 'a1',
      tenantId: 't1',
    });
    expect(audit.id).toBe('a1');
  });

  it('marks the audit FAILED if enqueue throws (no PENDING orphan)', async () => {
    prisma.audit.create.mockResolvedValue({ id: 'a1', tenantId: 't1' });
    send.mockRejectedValue(new Error('queue down'));

    await expect(service.create('https://x.com', 'u1', 't1')).rejects.toThrow();
    expect(prisma.audit.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'FAILED', error: 'Could not queue the audit' },
    });
  });

  it('throws NotFound when an audit is not in the tenant', async () => {
    prisma.audit.findFirst.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow('Audit not found');
  });
});
