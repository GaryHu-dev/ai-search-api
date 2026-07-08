/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { Prisma } from '@prisma/client';
import { TenantContext } from '../tenancy/tenant-context';

// Models whose rows belong to a tenant. Add a model here when it gains a
// `tenantId` — this single list is the only thing to remember, instead of a
// `where` clause on every query.
const TENANT_MODELS = new Set<string>(['File']);

// Operations that accept a `where` we can constrain to the current tenant.
// findUnique* are intentionally excluded — they key on unique fields only, so
// callers use findFirst for tenant-scoped lookups.
const WHERE_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

// Pure, testable core: returns a copy of `args` constrained to `tenantId` for
// the given operation. Reads/updates/deletes gain a `where.tenantId`; creates
// gain `data.tenantId`.
export function scopeArgs(operation: string, args: any, tenantId: string): any {
  const scoped = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation)) {
    scoped.where = { ...(scoped.where ?? {}), tenantId };
  } else if (operation === 'create') {
    scoped.data = { ...(scoped.data ?? {}), tenantId };
  } else if (operation === 'createMany') {
    scoped.data = Array.isArray(scoped.data)
      ? scoped.data.map((row: any) => ({ ...row, tenantId }))
      : { ...scoped.data, tenantId };
  } else if (operation === 'upsert') {
    scoped.where = { ...(scoped.where ?? {}), tenantId };
    scoped.create = { ...(scoped.create ?? {}), tenantId };
  }

  return scoped;
}

// Automatically scopes queries on tenant-owned models to the current tenant
// (from TenantContext). With no tenant in context (background jobs, pre-auth),
// it does nothing — deliberate cross-tenant/system access stays explicit. A
// database-level policy (Postgres RLS) is the intended fail-closed backstop.
export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        const tenantId = TenantContext.getTenantId();
        if (!model || !TENANT_MODELS.has(model) || !tenantId) {
          return query(args);
        }
        return query(scopeArgs(operation, args, tenantId));
      },
    },
  },
});
