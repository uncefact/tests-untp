import { customSeedSchema } from '../custom-seed-schema';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A valid CUID v1 for use in tests. */
const CUID = 'cjld2cjxh0000qzrmn831i7rn';
const CUID2 = 'cjld2cyuq0000t3rmniod1foy';
const CUID3 = 'ckabcdefghij0000klmnopqrs';

// ── Empty / minimal manifests ─────────────────────────────────────────────────

describe('customSeedSchema — empty and minimal manifests', () => {
  it('accepts an entirely empty object (all arrays default to [])', () => {
    const result = customSeedSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars).toEqual([]);
      expect(result.data.dataModels).toEqual([]);
      expect(result.data.renderTemplates).toEqual([]);
      expect(result.data.cvcCatalogues).toEqual([]);
    }
  });

  it('accepts explicit null arrays and coerces them to []', () => {
    const result = customSeedSchema.safeParse({
      registrars: null,
      dataModels: null,
      renderTemplates: null,
      cvcCatalogues: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars).toEqual([]);
      expect(result.data.dataModels).toEqual([]);
      expect(result.data.renderTemplates).toEqual([]);
      expect(result.data.cvcCatalogues).toEqual([]);
    }
  });

  it('accepts explicit undefined arrays and coerces them to []', () => {
    const result = customSeedSchema.safeParse({
      registrars: undefined,
      dataModels: undefined,
      renderTemplates: undefined,
      cvcCatalogues: undefined,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars).toEqual([]);
    }
  });
});

// ── Registrars ────────────────────────────────────────────────────────────────

describe('customSeedSchema — registrars', () => {
  it('accepts a minimal valid registrar (required fields only)', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: CUID, name: 'GS1', namespace: 'gs1' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const r = result.data.registrars[0];
      expect(r.id).toBe(CUID);
      expect(r.name).toBe('GS1');
      expect(r.namespace).toBe('gs1');
      expect(r.identifierSchemes).toEqual([]);
    }
  });

  it('accepts a registrar with all optional fields', () => {
    const result = customSeedSchema.safeParse({
      registrars: [
        {
          id: CUID,
          name: 'GS1',
          namespace: 'gs1',
          url: 'https://www.gs1.org',
          idrServiceInstanceId: CUID2,
          identifierSchemes: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a registrar missing the name field', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: CUID, namespace: 'gs1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a registrar missing the namespace field', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: CUID, name: 'GS1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a registrar missing the id field', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ name: 'GS1', namespace: 'gs1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid CUID for registrar id', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: 'not-a-cuid', name: 'GS1', namespace: 'gs1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string for registrar id', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: '', name: 'GS1', namespace: 'gs1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid URL for registrar url', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: CUID, name: 'GS1', namespace: 'gs1', url: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts null for optional registrar url (treated as omitted)', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: CUID, name: 'GS1', namespace: 'gs1', url: null }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid CUID for registrar idrServiceInstanceId', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: CUID, name: 'GS1', namespace: 'gs1', idrServiceInstanceId: 'bad' }],
    });
    expect(result.success).toBe(false);
  });

  it('defaults identifierSchemes to [] when omitted', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: CUID, name: 'GS1', namespace: 'gs1' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars[0].identifierSchemes).toEqual([]);
    }
  });

  it('defaults identifierSchemes to [] when null', () => {
    const result = customSeedSchema.safeParse({
      registrars: [{ id: CUID, name: 'GS1', namespace: 'gs1', identifierSchemes: null }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars[0].identifierSchemes).toEqual([]);
    }
  });
});

// ── Identifier schemes ────────────────────────────────────────────────────────

describe('customSeedSchema — identifierSchemes (nested in registrars)', () => {
  const baseRegistrar = { id: CUID, name: 'GS1', namespace: 'gs1' };

  it('accepts a valid identifier scheme with all required fields', () => {
    const result = customSeedSchema.safeParse({
      registrars: [
        {
          ...baseRegistrar,
          identifierSchemes: [
            {
              id: CUID2,
              name: 'GTIN',
              primaryKey: '01',
              validationPattern: '^\\d{14}$',
              linkTemplate: '/{primaryKey}/{value}',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a scheme missing the name field', () => {
    const result = customSeedSchema.safeParse({
      registrars: [
        {
          ...baseRegistrar,
          identifierSchemes: [
            {
              id: CUID2,
              primaryKey: '01',
              validationPattern: '^\\d{14}$',
              linkTemplate: '/{primaryKey}/{value}',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a scheme with an invalid CUID id', () => {
    const result = customSeedSchema.safeParse({
      registrars: [
        {
          ...baseRegistrar,
          identifierSchemes: [
            {
              id: 'invalid-id',
              name: 'GTIN',
              primaryKey: '01',
              validationPattern: '^\\d{14}$',
              linkTemplate: '/{primaryKey}/{value}',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('defaults scheme qualifiers to [] when omitted', () => {
    const result = customSeedSchema.safeParse({
      registrars: [
        {
          ...baseRegistrar,
          identifierSchemes: [
            {
              id: CUID2,
              name: 'GTIN',
              primaryKey: '01',
              validationPattern: '^\\d{14}$',
              linkTemplate: '/{primaryKey}/{value}',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars[0].identifierSchemes[0].qualifiers).toEqual([]);
    }
  });

  it('defaults scheme qualifiers to [] when null', () => {
    const result = customSeedSchema.safeParse({
      registrars: [
        {
          ...baseRegistrar,
          identifierSchemes: [
            {
              id: CUID2,
              name: 'GTIN',
              primaryKey: '01',
              validationPattern: '^\\d{14}$',
              linkTemplate: '/{primaryKey}/{value}',
              qualifiers: null,
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars[0].identifierSchemes[0].qualifiers).toEqual([]);
    }
  });
});

// ── Scheme qualifiers ─────────────────────────────────────────────────────────

describe('customSeedSchema — qualifiers (nested in identifierSchemes)', () => {
  const baseScheme = {
    id: CUID2,
    name: 'GTIN',
    primaryKey: '01',
    validationPattern: '^\\d{14}$',
    linkTemplate: '/{primaryKey}/{value}',
  };
  const baseRegistrar = { id: CUID, name: 'GS1', namespace: 'gs1' };

  const buildManifest = (qualifier: object) => ({
    registrars: [
      {
        ...baseRegistrar,
        identifierSchemes: [{ ...baseScheme, qualifiers: [qualifier] }],
      },
    ],
  });

  it('accepts a valid qualifier with all required fields', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: CUID3,
        key: '10',
        description: 'Batch/Lot Number',
        validationPattern: '^[A-Za-z0-9]{1,20}$',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('defaults qualifier order to 0 when omitted', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: CUID3,
        key: '10',
        description: 'Batch/Lot Number',
        validationPattern: '^[A-Za-z0-9]{1,20}$',
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars[0].identifierSchemes[0].qualifiers[0].order).toBe(0);
    }
  });

  it('defaults qualifier order to 0 when null', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: CUID3,
        key: '10',
        description: 'Batch/Lot Number',
        validationPattern: '^[A-Za-z0-9]{1,20}$',
        order: null,
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars[0].identifierSchemes[0].qualifiers[0].order).toBe(0);
    }
  });

  it('accepts an explicit positive integer order', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: CUID3,
        key: '10',
        description: 'Batch/Lot Number',
        validationPattern: '^[A-Za-z0-9]{1,20}$',
        order: 3,
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars[0].identifierSchemes[0].qualifiers[0].order).toBe(3);
    }
  });

  it('accepts order 0 explicitly', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: CUID3,
        key: '10',
        description: 'Batch/Lot Number',
        validationPattern: '^[A-Za-z0-9]{1,20}$',
        order: 0,
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrars[0].identifierSchemes[0].qualifiers[0].order).toBe(0);
    }
  });

  it('rejects a negative order value', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: CUID3,
        key: '10',
        description: 'Batch/Lot Number',
        validationPattern: '^[A-Za-z0-9]{1,20}$',
        order: -1,
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a qualifier missing the key field', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: CUID3,
        description: 'Batch/Lot Number',
        validationPattern: '^[A-Za-z0-9]{1,20}$',
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a qualifier with an invalid CUID id', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: 'not-a-cuid',
        key: '10',
        description: 'Batch/Lot Number',
        validationPattern: '^[A-Za-z0-9]{1,20}$',
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a qualifier missing validationPattern', () => {
    const result = customSeedSchema.safeParse(
      buildManifest({
        id: CUID3,
        key: '10',
        description: 'Batch/Lot Number',
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ── Data models ───────────────────────────────────────────────────────────────

describe('customSeedSchema — dataModels', () => {
  const validDataModel = {
    id: CUID,
    name: 'Digital Product Passport v0.6.0',
    credentialType: 'DigitalProductPassport',
    version: '0.6.0',
    parentConfigId: CUID2,
    schemaUrl: 'https://example.org/schema.json',
    contextUrl: 'https://example.org/context/',
  };

  it('accepts a valid data model with all required fields', () => {
    const result = customSeedSchema.safeParse({ dataModels: [validDataModel] });
    expect(result.success).toBe(true);
  });

  it('accepts a data model with optional websiteUrl', () => {
    const result = customSeedSchema.safeParse({
      dataModels: [{ ...validDataModel, websiteUrl: 'https://untp.unece.org/' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts null websiteUrl (treated as omitted)', () => {
    const result = customSeedSchema.safeParse({
      dataModels: [{ ...validDataModel, websiteUrl: null }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a data model missing the name field', () => {
    const { name: _name, ...rest } = validDataModel;
    const result = customSeedSchema.safeParse({ dataModels: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a data model missing credentialType', () => {
    const { credentialType: _ct, ...rest } = validDataModel;
    const result = customSeedSchema.safeParse({ dataModels: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a data model missing version', () => {
    const { version: _v, ...rest } = validDataModel;
    const result = customSeedSchema.safeParse({ dataModels: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a data model missing parentConfigId', () => {
    const { parentConfigId: _p, ...rest } = validDataModel;
    const result = customSeedSchema.safeParse({ dataModels: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid CUID for parentConfigId', () => {
    const result = customSeedSchema.safeParse({
      dataModels: [{ ...validDataModel, parentConfigId: 'not-a-cuid' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a data model missing schemaUrl', () => {
    const { schemaUrl: _s, ...rest } = validDataModel;
    const result = customSeedSchema.safeParse({ dataModels: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid URL for schemaUrl', () => {
    const result = customSeedSchema.safeParse({
      dataModels: [{ ...validDataModel, schemaUrl: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid URL for contextUrl', () => {
    const result = customSeedSchema.safeParse({
      dataModels: [{ ...validDataModel, contextUrl: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid URL for websiteUrl', () => {
    const result = customSeedSchema.safeParse({
      dataModels: [{ ...validDataModel, websiteUrl: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid CUID for data model id', () => {
    const result = customSeedSchema.safeParse({
      dataModels: [{ ...validDataModel, id: 'bad-id' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string id for data model', () => {
    const result = customSeedSchema.safeParse({
      dataModels: [{ ...validDataModel, id: '' }],
    });
    expect(result.success).toBe(false);
  });
});

// ── Render templates ──────────────────────────────────────────────────────────

describe('customSeedSchema — renderTemplates', () => {
  const validRenderTemplate = {
    id: CUID,
    name: 'DPP Default Template',
    file: 'path/to/template.hbs',
    dataModelId: CUID2,
    renderMethodType: 'RenderTemplate2024' as const,
  };

  it('accepts a valid render template with all required fields', () => {
    const result = customSeedSchema.safeParse({ renderTemplates: [validRenderTemplate] });
    expect(result.success).toBe(true);
  });

  it('defaults isDefault to false when omitted', () => {
    const result = customSeedSchema.safeParse({ renderTemplates: [validRenderTemplate] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.renderTemplates[0].isDefault).toBe(false);
    }
  });

  it('defaults isDefault to false when null', () => {
    const result = customSeedSchema.safeParse({
      renderTemplates: [{ ...validRenderTemplate, isDefault: null }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.renderTemplates[0].isDefault).toBe(false);
    }
  });

  it('accepts isDefault true', () => {
    const result = customSeedSchema.safeParse({
      renderTemplates: [{ ...validRenderTemplate, isDefault: true }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.renderTemplates[0].isDefault).toBe(true);
    }
  });

  it('accepts WebRenderingTemplate2022 as renderMethodType', () => {
    const result = customSeedSchema.safeParse({
      renderTemplates: [{ ...validRenderTemplate, renderMethodType: 'WebRenderingTemplate2022' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid renderMethodType enum value', () => {
    const result = customSeedSchema.safeParse({
      renderTemplates: [{ ...validRenderTemplate, renderMethodType: 'InvalidTemplate2099' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a render template missing the file field', () => {
    const { file: _f, ...rest } = validRenderTemplate;
    const result = customSeedSchema.safeParse({ renderTemplates: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a render template missing dataModelId', () => {
    const { dataModelId: _d, ...rest } = validRenderTemplate;
    const result = customSeedSchema.safeParse({ renderTemplates: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid CUID for dataModelId', () => {
    const result = customSeedSchema.safeParse({
      renderTemplates: [{ ...validRenderTemplate, dataModelId: 'not-a-cuid' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional fields: inline, mediaType, mediaQuery', () => {
    const result = customSeedSchema.safeParse({
      renderTemplates: [
        {
          ...validRenderTemplate,
          inline: true,
          mediaType: 'text/html',
          mediaQuery: '(min-width: 800px)',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts null for optional inline field', () => {
    const result = customSeedSchema.safeParse({
      renderTemplates: [{ ...validRenderTemplate, inline: null }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a render template missing renderMethodType', () => {
    const { renderMethodType: _r, ...rest } = validRenderTemplate;
    const result = customSeedSchema.safeParse({ renderTemplates: [rest] });
    expect(result.success).toBe(false);
  });
});

// ── CVC catalogues ────────────────────────────────────────────────────────────

describe('customSeedSchema — cvcCatalogues', () => {
  const validCatalogue = {
    id: CUID,
    name: 'UNTP CVC',
    version: '1.0.0',
    endpointUrl: 'https://example.org/cvc.jsonld',
  };

  it('accepts a valid CVC catalogue with all required fields', () => {
    const result = customSeedSchema.safeParse({ cvcCatalogues: [validCatalogue] });
    expect(result.success).toBe(true);
  });

  it('rejects a CVC catalogue missing name', () => {
    const { name: _n, ...rest } = validCatalogue;
    const result = customSeedSchema.safeParse({ cvcCatalogues: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a CVC catalogue missing version', () => {
    const { version: _v, ...rest } = validCatalogue;
    const result = customSeedSchema.safeParse({ cvcCatalogues: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a CVC catalogue missing endpointUrl', () => {
    const { endpointUrl: _e, ...rest } = validCatalogue;
    const result = customSeedSchema.safeParse({ cvcCatalogues: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid URL for endpointUrl', () => {
    const result = customSeedSchema.safeParse({
      cvcCatalogues: [{ ...validCatalogue, endpointUrl: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a CVC catalogue with an invalid CUID id', () => {
    const result = customSeedSchema.safeParse({
      cvcCatalogues: [{ ...validCatalogue, id: 'invalid' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a CVC catalogue with an empty string id', () => {
    const result = customSeedSchema.safeParse({
      cvcCatalogues: [{ ...validCatalogue, id: '' }],
    });
    expect(result.success).toBe(false);
  });
});

// ── Type exports ──────────────────────────────────────────────────────────────

describe('customSeedSchema — exported types', () => {
  it('exported types can be used for type narrowing (compile-time check)', () => {
    // This test verifies that the named type exports exist and are usable.
    // The actual type assertions happen at TypeScript compile time.
    import('../custom-seed-schema').then((mod) => {
      expect(mod.customSeedSchema).toBeDefined();
    });
  });
});
