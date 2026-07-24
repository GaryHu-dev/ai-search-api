import { scopeArgs, tenantScopeExtension } from '../tenant-scope.extension';
import { TenantContext } from '../../tenancy/tenant-context';

// Camel-cased model accessor -> PascalCase model name, matching how a real
// Prisma Client exposes models (`prisma.siteAudit` for the `SiteAudit` model).
// `file`/`siteAudit`/`notification` are in TENANT_MODELS; `user` deliberately
// is not, so the pass-through branch can be exercised too.
const MODEL_KEYS: Record<string, string> = {
  file: 'File',
  siteAudit: 'SiteAudit',
  notification: 'Notification',
  user: 'User',
};
const OPERATIONS = ['findMany', 'findUnique', 'findUniqueOrThrow'] as const;

// Minimal stand-in for a Prisma base client: just enough of the `$extends`
// contract for a `query.$allModels.$allOperations` extension to run against,
// without a live database. Each stubbed operation resolves with the
// model/operation/args it was ultimately invoked with, so a test can assert
// on the *transformed* args the extension passed down the chain (real
// input/output), rather than merely that some mock was called.
function buildExtendedClient() {
  function buildModels(
    resolve: (model: string, operation: string, args: unknown) => unknown,
  ) {
    const models: Record<
      string,
      Record<string, (args: unknown) => unknown>
    > = {};
    for (const key of Object.keys(MODEL_KEYS)) {
      models[key] = {};
      for (const operation of OPERATIONS) {
        models[key][operation] = (args: unknown) =>
          resolve(MODEL_KEYS[key], operation, args);
      }
    }
    return models;
  }

  const baseClient: any = {
    ...buildModels((model, operation, args) =>
      Promise.resolve({ model, operation, args }),
    ),
    $extends(extArgs: any) {
      const hook = extArgs.query.$allModels.$allOperations;
      return buildModels((model, operation, args) =>
        hook({
          model,
          operation,
          args,
          query: (finalArgs: unknown) =>
            Promise.resolve({ model, operation, args: finalArgs }),
        }),
      );
    },
  };

  return tenantScopeExtension(baseClient) as unknown as Record<
    string,
    Record<
      string,
      (
        args: unknown,
      ) => Promise<{ model: string; operation: string; args: unknown }>
    >
  >;
}

describe('scopeArgs (tenant-scope injection)', () => {
  const T = 'tenant-1';

  it('injects tenantId into a fresh where for reads', () => {
    expect(scopeArgs('findMany', { orderBy: { id: 'desc' } }, T)).toEqual({
      orderBy: { id: 'desc' },
      where: { tenantId: T },
    });
  });

  it('merges tenantId into an existing where', () => {
    expect(scopeArgs('findFirst', { where: { id: 'x' } }, T)).toEqual({
      where: { id: 'x', tenantId: T },
    });
  });

  it('injects tenantId into data on create', () => {
    expect(scopeArgs('create', { data: { name: 'a' } }, T)).toEqual({
      data: { name: 'a', tenantId: T },
    });
  });

  it('injects tenantId into every row on createMany', () => {
    expect(scopeArgs('createMany', { data: [{ a: 1 }, { a: 2 }] }, T)).toEqual({
      data: [
        { a: 1, tenantId: T },
        { a: 2, tenantId: T },
      ],
    });
  });

  it('scopes both where and create on upsert', () => {
    expect(
      scopeArgs('upsert', { where: { id: 'x' }, create: { a: 1 } }, T),
    ).toEqual({
      where: { id: 'x', tenantId: T },
      create: { a: 1, tenantId: T },
    });
  });

  it('scopes delete by where', () => {
    expect(scopeArgs('delete', { where: { id: 'x' } }, T)).toEqual({
      where: { id: 'x', tenantId: T },
    });
  });

  it('does not mutate the original args', () => {
    const original = { where: { id: 'x' } };
    scopeArgs('findFirst', original, T);
    expect(original).toEqual({ where: { id: 'x' } });
  });

  it('throws when a create carries a mismatched explicit tenantId', () => {
    expect(() =>
      scopeArgs('create', { data: { name: 'a', tenantId: 'other' } }, T),
    ).toThrow(/tenant context/);
  });

  it('allows an explicit tenantId that matches the context', () => {
    expect(scopeArgs('create', { data: { a: 1, tenantId: T } }, T)).toEqual({
      data: { a: 1, tenantId: T },
    });
  });

  it('throws when an update payload carries a foreign data.tenantId', () => {
    expect(() =>
      scopeArgs(
        'update',
        { where: { id: 'x' }, data: { name: 'a', tenantId: 'other' } },
        T,
      ),
    ).toThrow(/tenant context/);
  });

  it('allows a normal update and still scopes the where by tenant', () => {
    expect(
      scopeArgs('update', { where: { id: 'x' }, data: { name: 'a' } }, T),
    ).toEqual({
      where: { id: 'x', tenantId: T },
      data: { name: 'a' },
    });
  });

  it('throws when an updateMany payload carries a foreign data.tenantId', () => {
    expect(() =>
      scopeArgs(
        'updateMany',
        { where: { id: 'x' }, data: { tenantId: 'other' } },
        T,
      ),
    ).toThrow(/tenant context/);
  });

  it('throws when an upsert update branch carries a foreign data.tenantId', () => {
    expect(() =>
      scopeArgs(
        'upsert',
        { where: { id: 'x' }, create: { a: 1 }, update: { tenantId: 'other' } },
        T,
      ),
    ).toThrow(/tenant context/);
  });
});

describe('tenantScopeExtension (wrapper logic)', () => {
  const T = 'tenant-1';

  it('fails closed: a tenant-model operation with no TenantContext throws', () => {
    const client = buildExtendedClient();

    expect(() => client.file.findMany({ where: { id: 'x' } })).toThrow(
      /Tenant context is required to access File/,
    );
    expect(() => client.siteAudit.findMany({})).toThrow(
      /Tenant context is required to access SiteAudit/,
    );
    expect(() => client.notification.findMany({})).toThrow(
      /Tenant context is required to access Notification/,
    );
  });

  it('refuses findUnique on a tenant model even inside a TenantContext', () => {
    const client = buildExtendedClient();

    TenantContext.run(T, () => {
      expect(() => client.file.findUnique({ where: { id: 'x' } })).toThrow(
        /findUnique bypasses tenant scoping on File/,
      );
      expect(() =>
        client.siteAudit.findUniqueOrThrow({ where: { id: 'x' } }),
      ).toThrow(/findUniqueOrThrow bypasses tenant scoping on SiteAudit/);
    });
  });

  it('refuses findUnique on a tenant model outside a TenantContext too (no-context check runs first)', () => {
    const client = buildExtendedClient();

    expect(() => client.file.findUnique({ where: { id: 'x' } })).toThrow(
      /Tenant context is required to access File/,
    );
  });

  it('injects where.tenantId for a tenant-model findMany inside TenantContext', async () => {
    const client = buildExtendedClient();

    const result = await TenantContext.run(T, () =>
      client.siteAudit.findMany({ where: { url: 'x' } }),
    );

    expect(result).toEqual({
      model: 'SiteAudit',
      operation: 'findMany',
      args: { where: { url: 'x', tenantId: T } },
    });
  });

  it('lets a non-tenant model pass through untouched, with or without a TenantContext', async () => {
    const client = buildExtendedClient();
    const args = { where: { id: 'x' } };

    const outside = await client.user.findMany(args);
    expect(outside).toEqual({ model: 'User', operation: 'findMany', args });

    const inside = await TenantContext.run(T, () => client.user.findMany(args));
    expect(inside).toEqual({ model: 'User', operation: 'findMany', args });

    // findUnique is also untouched for non-tenant models: the refusal only
    // applies to models in TENANT_MODELS.
    const uniqueResult = await client.user.findUnique(args);
    expect(uniqueResult).toEqual({
      model: 'User',
      operation: 'findUnique',
      args,
    });
  });
});
