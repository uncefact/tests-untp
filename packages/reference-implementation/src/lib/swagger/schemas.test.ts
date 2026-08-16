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

/**
 * Structural coverage for the Facility response component. buildFacilitySchema
 * (schemas.ts) is deliberately function-local rather than a module-level export
 * (a top-level Zod chain off '@uncefact/untp-ri-services' imports crashes any
 * suite that partially mocks that package), so the only way to assert its shape
 * is against the generated JSON output, which is also the actual published
 * contract consumers read.
 *
 * Scoped to the Facility component only; other domains' components are not this
 * suite's concern.
 */
describe('generateOpenAPISchemas — Facility component', () => {
  type JsonSchema = {
    type?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    nullable?: boolean;
  };

  const facility = generateOpenAPISchemas().Facility as JsonSchema;

  it('requires every field that every handler returns', () => {
    expect(facility.required).toEqual(
      expect.arrayContaining([
        'id',
        'tenantId',
        'name',
        'description',
        'location',
        'operatingOrganisationId',
        'primaryIdentifierId',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('declares but does not require the list-versus-detail asymmetric fields', () => {
    const asymmetricFields = [
      'secondaryIdentifierIds',
      'primaryIdentifier',
      'secondaryIdentifiers',
      'operatingOrganisation',
    ];
    for (const field of asymmetricFields) {
      expect(facility.properties).toHaveProperty(field);
      expect(facility.required).not.toContain(field);
    }
  });

  it('marks primaryIdentifier and operatingOrganisation nullable (both are nullable FKs)', () => {
    expect(facility.properties?.primaryIdentifier?.nullable).toBe(true);
    expect(facility.properties?.operatingOrganisation?.nullable).toBe(true);
  });

  it("embeds the primary identifier's scheme without qualifiers, with registrar required", () => {
    const primaryIdentifier = facility.properties?.primaryIdentifier;
    expect(primaryIdentifier?.required).toContain('scheme');

    const scheme = primaryIdentifier?.properties?.scheme;
    expect(scheme?.properties).not.toHaveProperty('qualifiers');
    expect(scheme?.properties).toHaveProperty('registrar');
    expect(scheme?.required).toContain('registrar');
  });

  it('requires facilityId, identifierId, and identifier on each secondary identifier link', () => {
    const link = facility.properties?.secondaryIdentifiers?.items;
    expect(link?.required).toEqual(expect.arrayContaining(['facilityId', 'identifierId', 'identifier']));
  });

  it('embeds the same scheme shape (no qualifiers, required registrar) in secondary identifier links', () => {
    const linkIdentifier = facility.properties?.secondaryIdentifiers?.items?.properties?.identifier;
    expect(linkIdentifier?.required).toContain('scheme');

    const linkScheme = linkIdentifier?.properties?.scheme;
    expect(linkScheme?.properties).not.toHaveProperty('qualifiers');
    expect(linkScheme?.properties).toHaveProperty('registrar');
    expect(linkScheme?.required).toContain('registrar');
  });

  // The nested registrar must stay the truncated shape. FACILITY_DETAIL_INCLUDE
  // fetches the registrar's own columns only, so republishing the standalone
  // Registrar resource's `schemes` array here would promise consumers a list of
  // that registrar's other schemes which no facility response returns. Both
  // nesting paths are checked, since they are built from the same projection
  // but reached through different relations.
  it.each([
    ['primaryIdentifier', () => facility.properties?.primaryIdentifier?.properties?.scheme],
    [
      'secondaryIdentifiers',
      () => facility.properties?.secondaryIdentifiers?.items?.properties?.identifier?.properties?.scheme,
    ],
  ])('gives the %s scheme a registrar with no schemes array', (_path, getScheme) => {
    const registrar = getScheme()?.properties?.registrar;
    expect(registrar?.properties).toBeDefined();
    expect(registrar?.properties).not.toHaveProperty('schemes');
  });

  it('embeds the operating organisation as its own columns only, not its identifier relations', () => {
    const operatingOrganisation = facility.properties?.operatingOrganisation;
    expect(operatingOrganisation?.properties).not.toHaveProperty('primaryIdentifier');
    expect(operatingOrganisation?.properties).not.toHaveProperty('secondaryIdentifierIds');
    expect(operatingOrganisation?.required).toEqual(
      expect.arrayContaining(['id', 'tenantId', 'name', 'description', 'location', 'primaryIdentifierId']),
    );
  });
});
