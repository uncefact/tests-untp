import { Prisma } from '../../src/lib/prisma/generated';

/**
 * Regression guard for the multi-tenancy uniqueness contract on Identifier.
 *
 * Identifier schemes seeded under the system tenant are shared rows, so a
 * uniqueness key of [schemeId, value] alone makes identifier values unique
 * across ALL tenants: the second tenant to register a value against a shared
 * scheme fails on a constraint it cannot see (all identifier reads are
 * tenant-filtered) and cannot recover from. Uniqueness must therefore include
 * the tenant, matching the convention used by every other tenant-owned model.
 */
describe('Identifier tenancy contract', () => {
  it('scopes identifier uniqueness to the tenant', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Identifier');

    expect(model).toBeDefined();
    expect(model?.uniqueFields).toContainEqual(['schemeId', 'value', 'tenantId']);
    expect(model?.uniqueFields).not.toContainEqual(['schemeId', 'value']);
  });
});
