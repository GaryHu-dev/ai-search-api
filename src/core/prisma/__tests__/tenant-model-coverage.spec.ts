import { Prisma } from '@prisma/client';
import {
  TENANT_MODELS,
  UNSCOPED_TENANT_MODELS,
} from '../tenant-scope.extension';

// Guards the tenant-isolation convention: every model carrying a `tenantId` must
// be a conscious decision — auto-scoped (TENANT_MODELS) or explicitly exempt
// (UNSCOPED_TENANT_MODELS). A new tenant-bearing model added to the schema and
// forgotten in both would silently be reachable across tenants; this fails first.
describe('tenant model coverage', () => {
  const tenantBearingModels = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
    .map((model) => model.name);

  it('finds the tenant-bearing models', () => {
    expect(tenantBearingModels.length).toBeGreaterThan(0);
  });

  it.each(tenantBearingModels)(
    'model %s is scoped or explicitly exempt',
    (model: string) => {
      expect(
        TENANT_MODELS.has(model) || UNSCOPED_TENANT_MODELS.has(model),
      ).toBe(true);
    },
  );
});
