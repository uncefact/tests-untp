import { buildUpsertOperations } from '../custom-seed-upsert';
import type { CustomSeedManifest } from '../custom-seed-schema';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT_ID = 'csystem00000000000000001';

/** Valid CUID v1 fixtures */
const IDS = {
  registrar1: 'cjld2cjxh0000qzrmn831i7rn',
  registrar2: 'cjld2cyuq0000t3rmniod1foy',
  scheme1: 'ckabcdefghij0000klmnopqrs',
  scheme2: 'ckabcdefghij0001klmnopqrt',
  scheme3: 'ckabcdefghij0002klmnopqru',
  qualifier1: 'ckabcdefghij0003klmnopqrv',
  qualifier2: 'ckabcdefghij0004klmnopqrw',
  dataModel1: 'ckabcdefghij0005klmnopqrx',
  renderTemplate1: 'ckabcdefghij0006klmnopqry',
  cvcCatalogue1: 'ckabcdefghij0007klmnopqrz',
  idrServiceInstance: 'ckabcdefghij0008klmnopqsa',
  parentConfig: 'ckabcdefghij0009klmnopqsb',
};

/** Builds a minimal valid manifest with no entries. */
function emptyManifest(): CustomSeedManifest {
  return {
    registrars: [],
    dataModels: [],
    renderTemplates: [],
  };
}

// ── Empty manifest ────────────────────────────────────────────────────────────

describe('buildUpsertOperations — empty manifest', () => {
  it('returns all empty arrays when given an empty manifest', () => {
    const result = buildUpsertOperations(emptyManifest(), TENANT_ID);

    expect(result.registrars).toEqual([]);
    expect(result.identifierSchemes).toEqual([]);
    expect(result.qualifiers).toEqual([]);
    expect(result.dataModels).toEqual([]);
    expect(result.renderTemplates).toEqual([]);
  });
});

// ── Registrar flattening ──────────────────────────────────────────────────────

describe('buildUpsertOperations — registrar with nested schemes and qualifiers', () => {
  const manifest: CustomSeedManifest = {
    ...emptyManifest(),
    registrars: [
      {
        id: IDS.registrar1,
        name: 'GS1',
        namespace: 'gs1',
        url: 'https://www.gs1.org',
        idrServiceInstanceId: null,
        identifierSchemes: [
          {
            id: IDS.scheme1,
            name: 'Global Trade Item Number',
            primaryKey: '01',
            validationPattern: '^\\d{14}$',
            linkTemplate: '/01/{value}',
            qualifiers: [
              {
                id: IDS.qualifier1,
                key: '10',
                description: 'Batch / Lot Number',
                validationPattern: '^[\\x21-\\x22\\x25-\\x2F\\x30-\\x3A\\x3C-\\x3F\\x41-\\x5A\\x5F\\x61-\\x7A]{0,20}$',
                order: 1,
              },
              {
                id: IDS.qualifier2,
                key: '21',
                description: 'Serial Number',
                validationPattern: '^[\\x21-\\x22\\x25-\\x2F\\x30-\\x3A\\x3C-\\x3F\\x41-\\x5A\\x5F\\x61-\\x7A]{0,20}$',
                order: 2,
              },
            ],
          },
        ],
      },
    ],
  };

  it('produces one registrar with tenantId set', () => {
    const { registrars } = buildUpsertOperations(manifest, TENANT_ID);

    expect(registrars).toHaveLength(1);
    expect(registrars[0]).toMatchObject({
      id: IDS.registrar1,
      tenantId: TENANT_ID,
      name: 'GS1',
      namespace: 'gs1',
      url: 'https://www.gs1.org',
      idrServiceInstanceId: null,
    });
  });

  it('flattens nested schemes and propagates registrarId', () => {
    const { identifierSchemes } = buildUpsertOperations(manifest, TENANT_ID);

    expect(identifierSchemes).toHaveLength(1);
    expect(identifierSchemes[0]).toMatchObject({
      id: IDS.scheme1,
      tenantId: TENANT_ID,
      registrarId: IDS.registrar1,
      name: 'Global Trade Item Number',
      primaryKey: '01',
      validationPattern: '^\\d{14}$',
      linkTemplate: '/01/{value}',
    });
  });

  it('flattens nested qualifiers and propagates schemeId', () => {
    const { qualifiers } = buildUpsertOperations(manifest, TENANT_ID);

    expect(qualifiers).toHaveLength(2);

    expect(qualifiers[0]).toMatchObject({
      id: IDS.qualifier1,
      schemeId: IDS.scheme1,
      key: '10',
      description: 'Batch / Lot Number',
      order: 1,
    });

    expect(qualifiers[1]).toMatchObject({
      id: IDS.qualifier2,
      schemeId: IDS.scheme1,
      key: '21',
      description: 'Serial Number',
      order: 2,
    });
  });
});

// ── Multiple registrars with multiple schemes ─────────────────────────────────

describe('buildUpsertOperations — multiple registrars with multiple schemes', () => {
  const manifest: CustomSeedManifest = {
    ...emptyManifest(),
    registrars: [
      {
        id: IDS.registrar1,
        name: 'Registrar One',
        namespace: 'reg-one',
        url: null,
        idrServiceInstanceId: null,
        identifierSchemes: [
          {
            id: IDS.scheme1,
            name: 'Scheme A',
            primaryKey: '01',
            validationPattern: '.*',
            linkTemplate: '/01/{value}',
            qualifiers: [],
          },
          {
            id: IDS.scheme2,
            name: 'Scheme B',
            primaryKey: '02',
            validationPattern: '.*',
            linkTemplate: '/02/{value}',
            qualifiers: [],
          },
        ],
      },
      {
        id: IDS.registrar2,
        name: 'Registrar Two',
        namespace: 'reg-two',
        url: null,
        idrServiceInstanceId: null,
        identifierSchemes: [
          {
            id: IDS.scheme3,
            name: 'Scheme C',
            primaryKey: '03',
            validationPattern: '.*',
            linkTemplate: '/03/{value}',
            qualifiers: [],
          },
        ],
      },
    ],
  };

  it('produces one entry per registrar', () => {
    const { registrars } = buildUpsertOperations(manifest, TENANT_ID);
    expect(registrars).toHaveLength(2);
    expect(registrars.map((r) => r.id)).toEqual([IDS.registrar1, IDS.registrar2]);
  });

  it('produces one entry per scheme across all registrars', () => {
    const { identifierSchemes } = buildUpsertOperations(manifest, TENANT_ID);
    expect(identifierSchemes).toHaveLength(3);
  });

  it('correctly assigns registrarId to schemes belonging to their parent', () => {
    const { identifierSchemes } = buildUpsertOperations(manifest, TENANT_ID);

    const reg1Schemes = identifierSchemes.filter((s) => s.registrarId === IDS.registrar1);
    const reg2Schemes = identifierSchemes.filter((s) => s.registrarId === IDS.registrar2);

    expect(reg1Schemes).toHaveLength(2);
    expect(reg2Schemes).toHaveLength(1);
    expect(reg2Schemes[0].id).toBe(IDS.scheme3);
  });

  it('returns empty qualifiers array when no qualifiers exist', () => {
    const { qualifiers } = buildUpsertOperations(manifest, TENANT_ID);
    expect(qualifiers).toEqual([]);
  });
});

// ── idrServiceInstanceId propagation ─────────────────────────────────────────

describe('buildUpsertOperations — idrServiceInstanceId propagation', () => {
  it('propagates idrServiceInstanceId when present', () => {
    const manifest: CustomSeedManifest = {
      ...emptyManifest(),
      registrars: [
        {
          id: IDS.registrar1,
          name: 'IDR Registrar',
          namespace: 'idr',
          url: null,
          idrServiceInstanceId: IDS.idrServiceInstance,
          identifierSchemes: [],
        },
      ],
    };

    const { registrars } = buildUpsertOperations(manifest, TENANT_ID);
    expect(registrars[0].idrServiceInstanceId).toBe(IDS.idrServiceInstance);
  });

  it('sets idrServiceInstanceId to null when absent', () => {
    const manifest: CustomSeedManifest = {
      ...emptyManifest(),
      registrars: [
        {
          id: IDS.registrar1,
          name: 'No IDR Registrar',
          namespace: 'no-idr',
          url: null,
          idrServiceInstanceId: null,
          identifierSchemes: [],
        },
      ],
    };

    const { registrars } = buildUpsertOperations(manifest, TENANT_ID);
    expect(registrars[0].idrServiceInstanceId).toBeNull();
  });
});

// ── Data models ───────────────────────────────────────────────────────────────

describe('buildUpsertOperations — data models', () => {
  const manifest: CustomSeedManifest = {
    ...emptyManifest(),
    dataModels: [
      {
        id: IDS.dataModel1,
        name: 'Digital Product Passport v0.6.0',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        parentConfigId: IDS.parentConfig,
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        websiteUrl: 'https://example.com',
      },
    ],
  };

  it('sets isExtension to true on all data models', () => {
    const { dataModels } = buildUpsertOperations(manifest, TENANT_ID);

    expect(dataModels).toHaveLength(1);
    expect(dataModels[0].isExtension).toBe(true);
  });

  it('sets tenantId from systemTenantId on all data models', () => {
    const { dataModels } = buildUpsertOperations(manifest, TENANT_ID);
    expect(dataModels[0].tenantId).toBe(TENANT_ID);
  });

  it('preserves all data model fields', () => {
    const { dataModels } = buildUpsertOperations(manifest, TENANT_ID);

    expect(dataModels[0]).toMatchObject({
      id: IDS.dataModel1,
      name: 'Digital Product Passport v0.6.0',
      credentialType: 'DigitalProductPassport',
      version: '0.6.0',
      parentConfigId: IDS.parentConfig,
      schemaUrl: 'https://example.com/schema.json',
      contextUrl: 'https://example.com/context.jsonld',
      websiteUrl: 'https://example.com',
    });
  });

  it('sets websiteUrl to null when absent', () => {
    const manifestNoWebsite: CustomSeedManifest = {
      ...emptyManifest(),
      dataModels: [
        {
          id: IDS.dataModel1,
          name: 'DPP',
          credentialType: 'DigitalProductPassport',
          version: '0.6.0',
          parentConfigId: IDS.parentConfig,
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          websiteUrl: null,
        },
      ],
    };

    const { dataModels } = buildUpsertOperations(manifestNoWebsite, TENANT_ID);
    expect(dataModels[0].websiteUrl).toBeNull();
  });
});

// ── Render templates ──────────────────────────────────────────────────────────

describe('buildUpsertOperations — render templates', () => {
  it('passes through render template data with tenantId and defaults', () => {
    const manifest: CustomSeedManifest = {
      ...emptyManifest(),
      renderTemplates: [
        {
          id: IDS.renderTemplate1,
          name: 'DPP Default Template',
          file: 'templates/dpp-default.hbs',
          dataModelId: IDS.dataModel1,
          renderMethodType: 'RenderTemplate2024',
          isDefault: true,
          inline: false,
          mediaType: 'text/html',
          mediaQuery: null,
        },
      ],
    };

    const { renderTemplates } = buildUpsertOperations(manifest, TENANT_ID);

    expect(renderTemplates).toHaveLength(1);
    expect(renderTemplates[0]).toMatchObject({
      id: IDS.renderTemplate1,
      tenantId: TENANT_ID,
      name: 'DPP Default Template',
      file: 'templates/dpp-default.hbs',
      dataModelId: IDS.dataModel1,
      renderMethodType: 'RenderTemplate2024',
      isDefault: true,
      inline: false,
      mediaType: 'text/html',
      mediaQuery: null,
    });
  });

  it('defaults isDefault to false when omitted (after schema transform)', () => {
    const manifest: CustomSeedManifest = {
      ...emptyManifest(),
      renderTemplates: [
        {
          id: IDS.renderTemplate1,
          name: 'Non-default Template',
          file: 'templates/other.hbs',
          dataModelId: IDS.dataModel1,
          renderMethodType: 'WebRenderingTemplate2022',
          isDefault: false,
          inline: null,
          mediaType: null,
          mediaQuery: null,
        },
      ],
    };

    const { renderTemplates } = buildUpsertOperations(manifest, TENANT_ID);
    expect(renderTemplates[0].isDefault).toBe(false);
  });

  it('sets null for optional fields when absent', () => {
    const manifest: CustomSeedManifest = {
      ...emptyManifest(),
      renderTemplates: [
        {
          id: IDS.renderTemplate1,
          name: 'Minimal Template',
          file: 'templates/minimal.hbs',
          dataModelId: IDS.dataModel1,
          renderMethodType: 'RenderTemplate2024',
          isDefault: false,
          inline: null,
          mediaType: null,
          mediaQuery: null,
        },
      ],
    };

    const { renderTemplates } = buildUpsertOperations(manifest, TENANT_ID);
    expect(renderTemplates[0].inline).toBeNull();
    expect(renderTemplates[0].mediaType).toBeNull();
    expect(renderTemplates[0].mediaQuery).toBeNull();
  });
});

// ── Pure function properties ──────────────────────────────────────────────────

describe('buildUpsertOperations — pure function properties', () => {
  it('does not mutate the input manifest', () => {
    const manifest: CustomSeedManifest = {
      ...emptyManifest(),
      registrars: [
        {
          id: IDS.registrar1,
          name: 'GS1',
          namespace: 'gs1',
          url: null,
          idrServiceInstanceId: null,
          identifierSchemes: [],
        },
      ],
    };

    const originalName = manifest.registrars[0].name;
    buildUpsertOperations(manifest, TENANT_ID);

    expect(manifest.registrars[0].name).toBe(originalName);
    expect(manifest.registrars).toHaveLength(1);
  });

  it('uses the provided systemTenantId, not a hardcoded value', () => {
    const customTenantId = 'custom-tenant-id-xyz';
    const manifest: CustomSeedManifest = {
      ...emptyManifest(),
      registrars: [
        {
          id: IDS.registrar1,
          name: 'GS1',
          namespace: 'gs1',
          url: null,
          idrServiceInstanceId: null,
          identifierSchemes: [
            {
              id: IDS.scheme1,
              name: 'Scheme',
              primaryKey: '01',
              validationPattern: '.*',
              linkTemplate: '/01/{value}',
              qualifiers: [],
            },
          ],
        },
      ],
      dataModels: [
        {
          id: IDS.dataModel1,
          name: 'DPP',
          credentialType: 'DigitalProductPassport',
          version: '0.6.0',
          parentConfigId: IDS.parentConfig,
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          websiteUrl: null,
        },
      ],
      renderTemplates: [
        {
          id: IDS.renderTemplate1,
          name: 'Template',
          file: 'template.hbs',
          dataModelId: IDS.dataModel1,
          renderMethodType: 'RenderTemplate2024',
          isDefault: false,
          inline: null,
          mediaType: null,
          mediaQuery: null,
        },
      ],
    };

    const result = buildUpsertOperations(manifest, customTenantId);

    expect(result.registrars[0].tenantId).toBe(customTenantId);
    expect(result.identifierSchemes[0].tenantId).toBe(customTenantId);
    expect(result.dataModels[0].tenantId).toBe(customTenantId);
    expect(result.renderTemplates[0].tenantId).toBe(customTenantId);
  });
});
