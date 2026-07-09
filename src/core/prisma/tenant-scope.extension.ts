/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { Prisma } from '@prisma/client';
import { TenantContext } from '../tenancy/tenant-context';

// Models whose rows belong to a tenant. Add a model here when it gains a
// `tenantId` — this single list is the only thing to remember, instead of a
// `where` clause on every query.
const TENANT_MODELS = new Set<string>(['File', 'Audit']);

// Operations that accept a `where` we can constrain to the current tenant.
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

// findUnique* key on unique fields only and can't be constrained by tenant, so
// they'd bypass isolation. The extension refuses them on tenant models — callers
// use findFirst instead.
const UNSCOPABLE_OPERATIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
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
// (from TenantContext). It fails CLOSED: a tenant model reached with no tenant
// in context — a missing guard, the wrong Prisma client, or a job that forgot
// TenantContext.run — throws rather than silently returning every tenant's rows.
// Non-tenant models (and clients used pre-auth) pass through untouched.
export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_MODELS.has(model)) {
          return query(args);
        }

        const tenantId = TenantContext.getTenantId();
        if (!tenantId) {
          throw new Error(
            `Tenant context is required to access ${model} through the tenant-scoped client`,
          );
        }
        if (UNSCOPABLE_OPERATIONS.has(operation)) {
          throw new Error(
            `${operation} bypasses tenant scoping on ${model}; use findFirst instead`,
          );
        }

        return query(scopeArgs(operation, args, tenantId));
      },
    },
  },
});
