import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantStore {
  tenantId: string;
}

// Per-request store for the current tenant. Set once per authenticated request
// (see TenantContextInterceptor) and read by the Prisma tenant-scope extension,
// so tenant filtering happens automatically instead of by hand on every query.
const storage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  // Binds the tenant to the current async execution (the request), so
  // everything downstream — handler, services, Prisma — sees it.
  enterWith(tenantId: string): void {
    storage.enterWith({ tenantId });
  },

  // Runs `fn` within an explicit tenant scope. Useful for background jobs that
  // act on behalf of a specific tenant.
  run<T>(tenantId: string, fn: () => T): T {
    return storage.run({ tenantId }, fn);
  },

  getTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  },
};
