import { scopeArgs } from '../tenant-scope.extension';

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
});
