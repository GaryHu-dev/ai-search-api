import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

// Either the base client or an interactive transaction client. Lets callers
// compose user creation into a larger atomic operation (e.g. registration,
// which also writes a login method).
type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Creates the tenant and its first user together. Today it's one user per
  // tenant; the tenant exists so more users can be added later without moving
  // any data.
  createUserWithTenant(
    data: { email: string; displayName?: string },
    db: Db = this.prisma,
  ): Promise<User> {
    return db.user.create({
      data: {
        email: data.email,
        displayName: data.displayName,
        tenant: { create: {} },
      },
    });
  }

  // Includes soft-deleted rows: callers that care about the email being taken
  // (registration, Google linking) need to see them.
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async getActiveById(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(id: string, dto: UpdateUserDto): Promise<User> {
    const existing = await this.getActiveById(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { displayName: dto.displayName },
    });
    await this.audit.record({
      action: 'user.updated',
      tenantId: existing.tenantId,
      actorUserId: id,
      targetType: 'user',
      targetId: id,
    });
    return updated;
  }

  // Soft delete: the row stays for history, but the account can no longer
  // authenticate — login and refresh both reject soft-deleted users, and any
  // outstanding access token dies at its short expiry.
  async softDelete(id: string): Promise<void> {
    const existing = await this.getActiveById(id);
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      action: 'user.deleted',
      tenantId: existing.tenantId,
      actorUserId: id,
      targetType: 'user',
      targetId: id,
    });
  }
}
