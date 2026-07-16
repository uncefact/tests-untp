import { generateOpenAPISchemas } from './schemas';

/**
 * Minimal shape for navigating the generated OpenAPI JSON schema in these
 * structural assertions. The real output carries far more (descriptions,
 * formats, additionalProperties); only the fields these tests read are
 * declared.
 */
type JsonSchemaObject = {
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
  nullable?: boolean;
};

/**
 * Congruence checks for the registrar <-> scheme OpenAPI projection (#792
 * design-fork resolution). `registrarSchema` and `identifierSchemeSchema`
 * are composed from file-private cores in the services package specifically
 * to avoid a circular reference between the two components; these
 * assertions guard the shape that composition is meant to produce, and
 * would fail if either side's projection regressed back towards a cycle.
 *
 * Each assertion below names the property it protects, so a failure states
 * which part of the projection moved. Whole-component byte-identity pinning
 * is deliberately not used: it reports that a component changed without
 * saying which guarantee broke, it cannot distinguish an intended edit from
 * an accidental one, and the resulting habit of regenerating the stored copy
 * lets the accidental case through under cover of the intended one.
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
});

describe('generateOpenAPISchemas — Organisation component', () => {
  // buildOrganisationSchema (in schemas.ts) is function-local and only
  // invoked from inside generateOpenAPISchemas, so the nested
  // primaryIdentifier/secondaryIdentifiers/secondaryIdentifierIds asymmetry
  // and the qualifiers-omission on the nested scheme have no other surface
  // to assert against; the generated JSON is the public contract.
  const schemas = generateOpenAPISchemas();
  const organisation = schemas.Organisation as JsonSchemaObject;

  it('requires every field present on both list and detail responses', () => {
    expect(organisation.required).toEqual(
      expect.arrayContaining([
        'id',
        'tenantId',
        'name',
        'description',
        'location',
        'primaryIdentifierId',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('lists primaryIdentifier, secondaryIdentifiers, and secondaryIdentifierIds as present but optional', () => {
    // Detail responses (create, get-by-id, update) include primaryIdentifier
    // and secondaryIdentifiers but omit secondaryIdentifierIds; list
    // responses do the reverse (ORGANISATION_DETAIL_INCLUDE vs
    // ORGANISATION_LIST_INCLUDE in organisation.repository.ts). None of the
    // three is present on every response, so none is required.
    expect(organisation.properties).toHaveProperty('primaryIdentifier');
    expect(organisation.properties).toHaveProperty('secondaryIdentifiers');
    expect(organisation.properties).toHaveProperty('secondaryIdentifierIds');
    expect(organisation.required ?? []).not.toContain('primaryIdentifier');
    expect(organisation.required ?? []).not.toContain('secondaryIdentifiers');
    expect(organisation.required ?? []).not.toContain('secondaryIdentifierIds');
  });

  it('marks primaryIdentifier nullable, matching a detail response with no primary identifier set', () => {
    // primaryIdentifierId (and so primaryIdentifier) can be null on an
    // organisation that has none; the response schema must allow it rather
    // than only allowing "present" or "absent".
    expect(organisation.properties?.primaryIdentifier?.nullable).toBe(true);
  });

  it('omits qualifiers from and requires registrar on the primaryIdentifier scheme projection', () => {
    // The repository's include (`scheme: { include: { registrar: true } }`)
    // never requests qualifiers, so a scheme nested here never carries one;
    // registrar is always requested, so it is always present.
    const primaryIdentifier = organisation.properties?.primaryIdentifier;
    const scheme = primaryIdentifier?.properties?.scheme;
    expect(scheme?.properties).not.toHaveProperty('qualifiers');
    expect(scheme?.required).toContain('registrar');
  });

  it('omits qualifiers from and requires registrar on the secondaryIdentifiers scheme projection', () => {
    // secondaryIdentifiers is an array of join records, each carrying the
    // same nested identifier/scheme/registrar shape as primaryIdentifier.
    const secondaryIdentifiers = organisation.properties?.secondaryIdentifiers;
    const identifier = secondaryIdentifiers?.items?.properties?.identifier;
    const scheme = identifier?.properties?.scheme;
    expect(scheme?.properties).not.toHaveProperty('qualifiers');
    expect(scheme?.required).toContain('registrar');
  });
});
