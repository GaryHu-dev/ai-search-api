import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string; // dotted verb, e.g. "auth.login", "user.updated"
  tenantId?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  requestId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Deliberately never throws: a failed audit write must not roll back or break
  // the business operation that triggered it. Failures are logged so they're
  // still visible.
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          tenantId: entry.tenantId,
          actorUserId: entry.actorUserId,
          targetType: entry.targetType,
          targetId: entry.targetId,
          metadata: entry.metadata as Prisma.InputJsonValue | undefined,
          ip: entry.ip,
          requestId: entry.requestId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `Failed to write audit log for "${entry.action}": ${message}`,
      );
    }
  }
}
