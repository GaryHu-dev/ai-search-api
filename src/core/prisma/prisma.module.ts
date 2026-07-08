import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { tenantScopeExtension } from './tenant-scope.extension';

// The tenant-scoped Prisma client: the same connection as PrismaService, with
// the tenant-scope extension applied. Inject this (via TENANT_PRISMA) wherever
// you touch tenant-owned models — queries are filtered to the current tenant
// automatically. Use the plain PrismaService for non-tenant / system work.
export const TENANT_PRISMA = Symbol('TENANT_PRISMA');

function buildTenantClient(prisma: PrismaService) {
  return prisma.$extends(tenantScopeExtension);
}

export type TenantPrismaClient = ReturnType<typeof buildTenantClient>;

// Global because the database is a genuinely cross-cutting dependency: feature
// modules should inject it without re-importing this module each time. This is
// the one place we reach for @Global() deliberately.
@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: TENANT_PRISMA,
      inject: [PrismaService],
      useFactory: buildTenantClient,
    },
  ],
  exports: [PrismaService, TENANT_PRISMA],
})
export class PrismaModule {}
