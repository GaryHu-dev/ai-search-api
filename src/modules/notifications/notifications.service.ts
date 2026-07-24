import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { ListQuery, Page, parseSort } from '../../core/common/pagination';
import {
  TENANT_PRISMA,
  TenantPrismaClient,
} from '../../core/prisma/prisma.module';

const SORTABLE_FIELDS = ['createdAt'] as const;

export interface NotifyInput {
  userId: string;
  tenantId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
  ) {}

  // Producer-facing: any module raises a notification for a specific user.
  // tenantId is passed explicitly (the tenant-scope extension also injects it
  // from context, so the two agree), matching audits.service.
  async notify(input: NotifyInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
      },
    });
  }

  // Every consumer method filters on userId explicitly: the tenant-scope
  // extension injects tenantId but knows nothing about the user, so without
  // this one user could read another's notifications within a tenant.
  async list(
    userId: string,
    query: ListQuery,
    unreadOnly: boolean,
  ): Promise<Page<Notification>> {
    const where = {
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
      ...(query.search
        ? {
            OR: [
              {
                title: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                body: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: parseSort(query.sort, SORTABLE_FIELDS, {
        field: 'createdAt',
        order: 'desc',
      }),
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  // Idempotent and atomic: 404 if the notification is not this user's (the
  // tenant-scope extension also confines it to tenant), otherwise the flip to
  // read is a single guarded updateMany (readAt: null in the where) rather
  // than a read-then-write, so two concurrent calls can't race each other.
  async markRead(userId: string, id: string): Promise<Notification> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Notification not found');

    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) return existing; // already read; nothing to flip

    const updated = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    return updated ?? existing;
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    return this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
