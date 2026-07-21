import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit.service';

describe('AuditService', () => {
  it('writes an audit entry', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuditService({
      auditLog: { create },
    } as unknown as PrismaService);

    await service.record({
      action: 'auth.login',
      tenantId: 't1',
      actorUserId: 'u1',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'auth.login', tenantId: 't1' }),
      }),
    );
  });

  it('never throws, even if the write fails', async () => {
    const service = new AuditService({
      auditLog: { create: jest.fn().mockRejectedValue(new Error('db down')) },
    } as unknown as PrismaService);

    await expect(
      service.record({ action: 'auth.login' }),
    ).resolves.toBeUndefined();
  });
});
