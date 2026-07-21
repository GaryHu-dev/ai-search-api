import { NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../core/audit/audit.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { UsersService } from '../users.service';

describe('UsersService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('getActiveById throws when the user is missing or soft-deleted', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.getActiveById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'missing', deletedAt: null },
    });
  });

  it('softDelete stamps deletedAt on an existing user', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    prisma.user.update.mockResolvedValue({ id: 'u1' });

    await service.softDelete('u1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.deleted' }),
    );
  });

  it('findByEmail looks the user up by unique email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

    await service.findByEmail('jane@example.com');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'jane@example.com' },
    });
  });

  it('updateProfile updates the display name and audits it', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', tenantId: 't1' });
    prisma.user.update.mockResolvedValue({ id: 'u1', displayName: 'New' });

    await service.updateProfile('u1', { displayName: 'New' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { displayName: 'New' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.updated' }),
    );
  });

  it('createUserWithTenant creates a user with a nested tenant', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u1' });

    await service.createUserWithTenant({
      email: 'jane@example.com',
      displayName: 'Jane',
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'jane@example.com',
        displayName: 'Jane',
        tenant: { create: {} },
      },
    });
  });
});
