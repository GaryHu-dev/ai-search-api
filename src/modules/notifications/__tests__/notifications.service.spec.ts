import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TENANT_PRISMA } from '../../../core/prisma/prisma.module';
import { ListQuery } from '../../../core/common/pagination';
import { NotificationsService } from '../notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const query = (over: Partial<ListQuery> = {}): ListQuery => ({
    limit: 20,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'n1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: TENANT_PRISMA, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('notify() creates a row with the given fields', async () => {
    await service.notify({
      userId: 'u1',
      tenantId: 't1',
      type: 'audit.completed',
      title: 'Audit complete',
      body: 'ready',
      data: { auditId: 'a1' },
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        userId: 'u1',
        type: 'audit.completed',
        title: 'Audit complete',
        body: 'ready',
        data: { auditId: 'a1' },
      },
    });
  });

  it('list() filters by userId and honours unreadOnly', async () => {
    await service.list('u1', query(), true);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', readAt: null } }),
    );
  });

  it('list() without unreadOnly filters by userId only', async () => {
    await service.list('u1', query(), false);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('list() filters by search across title and body', async () => {
    await service.list('u1', query({ search: 'audit' }), false);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          OR: [
            { title: { contains: 'audit', mode: 'insensitive' } },
            { body: { contains: 'audit', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  const row = (id: string) => ({
    id,
    userId: 'u1',
    title: `title-${id}`,
    body: `body-${id}`,
    readAt: null,
    createdAt: new Date(`2024-01-0${id}`),
  });

  it('list() slices the extra row and sets nextCursor to the last item returned', async () => {
    prisma.notification.findMany.mockResolvedValue([
      row('1'),
      row('2'),
      row('3'),
    ]);

    const page = await service.list('u1', query({ limit: 2 }), false);

    expect(page.items).toEqual([row('1'), row('2')]);
    expect(page.nextCursor).toBe('2');
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
  });

  it('list() returns nextCursor null when there is no extra row past the limit', async () => {
    prisma.notification.findMany.mockResolvedValue([row('1'), row('2')]);

    const page = await service.list('u1', query({ limit: 2 }), false);

    expect(page.items).toEqual([row('1'), row('2')]);
    expect(page.nextCursor).toBeNull();
  });

  it('list() passes cursor/skip through to findMany when a cursor is given', async () => {
    prisma.notification.findMany.mockResolvedValue([]);

    await service.list('u1', query({ cursor: 'abc' }), false);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'abc' }, skip: 1 }),
    );
  });

  it('list() combines search with unreadOnly', async () => {
    await service.list('u1', query({ search: 'audit' }), true);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          readAt: null,
          OR: [
            { title: { contains: 'audit', mode: 'insensitive' } },
            { body: { contains: 'audit', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it("unreadCount() counts only this user's unread", async () => {
    prisma.notification.count.mockResolvedValue(3);
    await expect(service.unreadCount('u1')).resolves.toBe(3);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
    });
  });

  it("markRead() 404s when the notification is not the user's", async () => {
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead('u1', 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u1' },
    });
  });

  it('markRead() is idempotent for an already-read notification', async () => {
    const already = { id: 'n1', readAt: new Date() };
    prisma.notification.findFirst.mockResolvedValue(already);
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markRead('u1', 'n1')).resolves.toBe(already);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('markRead() atomically sets readAt for an unread notification', async () => {
    const updated = { id: 'n1', readAt: new Date() };
    prisma.notification.findFirst
      .mockResolvedValueOnce({ id: 'n1', readAt: null })
      .mockResolvedValueOnce(updated);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.markRead('u1', 'n1')).resolves.toBe(updated);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("markAllRead() flips only this user's unread", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 2 });
    await expect(service.markAllRead('u1')).resolves.toEqual({ count: 2 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
