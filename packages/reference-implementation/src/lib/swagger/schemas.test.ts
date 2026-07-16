import { generateOpenAPISchemas } from './schemas';
import identifierSchemeFixture from './__fixtures__/identifier-scheme.pre-792.json';

/**
 * Congruence checks for the registrar <-> scheme OpenAPI projection (#792
 * design-fork resolution). `registrarSchema` and `identifierSchemeSchema`
 * are composed from file-private cores in the services package specifically
 * to avoid a circular reference between the two components; these
 * assertions guard the shape that composition is meant to produce, and
 * would fail if either side's projection regressed back towards a cycle.
 *
 * The byte-identity assertion below pins `IdentifierScheme`'s entire
 * generated shape, not just the registrar/scheme fields it was added to
 * guard. A deliberate, intentional change to `identifierSchemeSchema` (a
 * new field, a changed description, a reordered property) is expected to
 * fail this test; the fix is to regenerate
 * `__fixtures__/identifier-scheme.pre-792.json` from the new output, not to
 * treat the failure itself as a regression.
 */
describe('generateOpenAPISchemas — registrar/scheme projection congruence', () => {
  it('does not log a recursive-reference warning while generating', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    generateOpenAPISchemas();

    const recursionWarnings = warnSpy.mock.calls.filter(([message]) =>
      typeof message === 'string' ? message.includes('Recursive reference detected') : false,
    );
    expect(recursionWarnings).toEqual([]);

    warnSpy.mockRestore();
  });

  it('documents Registrar.schemes as an optional array of scheme-with-qualifiers items', () => {
    const schemas = generateOpenAPISchemas();
    const registrar = schemas.Registrar as {
      properties: {
        schemes: { type?: string; items?: { type?: string; properties?: Record<string, unknown> } };
      };
      required?: string[];
    };

    expect(registrar.properties.schemes.type).toBe('array');
    expect(registrar.required ?? []).not.toContain('schemes');

    const schemeItemProperties = registrar.properties.schemes.items?.properties ?? {};
    expect(registrar.properties.schemes.items?.type).toBe('object');
    for (const field of [
      'id',
      'tenantId',
      'registrarId',
      'name',
      'primaryKey',
      'validationPattern',
      'linkTemplate',
      'idrServiceInstanceId',
      'qualifiers',
      'createdAt',
      'updatedAt',
    ]) {
      expect(schemeItemProperties[field]).toBeDefined();
    }
  });

  it('gives Registrar.schemes items qualifiers but no nested registrar back-reference', () => {
    const schemas = generateOpenAPISchemas();
    const registrar = schemas.Registrar as {
      properties: { schemes: { items: { properties: Record<string, unknown> } } };
    };
    const schemeItemProperties = registrar.properties.schemes.items.properties;

    expect(schemeItemProperties.qualifiers).toBeDefined();
    expect(schemeItemProperties.registrar).toBeUndefined();
  });

  it("gives IdentifierScheme's nested registrar no schemes back-reference", () => {
    const schemas = generateOpenAPISchemas();
    const identifierScheme = schemas.IdentifierScheme as {
      properties: { registrar: { properties: Record<string, unknown> } };
    };

    expect(identifierScheme.properties.registrar.properties.schemes).toBeUndefined();
  });

  it('leaves the IdentifierScheme component byte-identical to the pre-#792 fixture, including property order', () => {
    const schemas = generateOpenAPISchemas();

    expect(JSON.stringify(schemas.IdentifierScheme)).toBe(JSON.stringify(identifierSchemeFixture));
  });
});
