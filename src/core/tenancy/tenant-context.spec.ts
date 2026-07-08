import { TenantContext } from './tenant-context';

describe('TenantContext', () => {
  it('exposes the tenant inside run()', () => {
    const seen = TenantContext.run('tenant-1', () =>
      TenantContext.getTenantId(),
    );
    expect(seen).toBe('tenant-1');
  });

  it('is undefined outside any scope', () => {
    expect(TenantContext.getTenantId()).toBeUndefined();
  });

  it('enterWith binds the tenant for the current async flow', () => {
    TenantContext.run('outer', () => {
      TenantContext.enterWith('inner');
      expect(TenantContext.getTenantId()).toBe('inner');
    });
  });
});
