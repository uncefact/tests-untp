import path from 'path';
import { validateManifestReferences, ValidationContext } from '../custom-seed-validate';
import { CustomSeedManifest } from '../custom-seed-schema';

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Valid CUID v1 values for use in tests. */
const ID_CORE_MODEL = 'cjld2cjxh0000qzrmn831i7rn';
const ID_CORE_MODEL_2 = 'cjld2cyuq0000t3rmniod1foy';
const ID_DATA_MODEL = 'ckabcdefghij0000klmnopqrs';
const ID_DATA_MODEL_2 = 'ckabcdefghij0001klmnopqrt';
const ID_RENDER_TEMPLATE = 'ckabcdefghij0002klmnopqru';
const ID_RENDER_TEMPLATE_2 = 'ckabcdefghij0003klmnopqrv';
const ID_CVC_CATALOGUE = 'ckabcdefghij0004klmnopqrw';
const ID_REGISTRAR = 'ckabcdefghij0005klmnopqrx';
const ID_SCHEME = 'ckabcdefghij0006klmnopqry';
const ID_QUALIFIER = 'ckabcdefghij0007klmnopqrz';
const ID_DB_DATA_MODEL = 'ckabcdefghij0008klmnopqsa';

const MOUNT_DIR = '/mnt/seed';

/** Build a minimal valid ValidationContext. */
function buildCtx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    coreDataModelIds: new Set([ID_CORE_MODEL, ID_CORE_MODEL_2]),
    allExistingDataModelIds: new Set([ID_CORE_MODEL, ID_CORE_MODEL_2, ID_DB_DATA_MODEL]),
    fileExists: () => true,
    resolvePath: (relativePath) => path.join(MOUNT_DIR, relativePath),
    mountDir: MOUNT_DIR,
    supportedCvcVersions: ['1.0.0', '1.1.0'],
    isNonSystemCollision: () => false,
    ...overrides,
  };
}

/** Build a minimal valid data model entry. */
function buildDataModel(idOverride = ID_DATA_MODEL, parentConfigId = ID_CORE_MODEL) {
  return {
    id: idOverride,
    name: 'Test Data Model',
    credentialType: 'TestCredential',
    version: '0.1.0',
    parentConfigId,
    schemaUrl: 'https://example.com/schema.json',
    contextUrl: 'https://example.com/context.json',
    websiteUrl: null,
  };
}

/** Build a minimal valid render template entry. */
function buildRenderTemplate(
  id = ID_RENDER_TEMPLATE,
  dataModelId = ID_DATA_MODEL,
  file = 'templates/test.hbs',
  isDefault = false,
) {
  return {
    id,
    name: 'Test Template',
    file,
    dataModelId,
    renderMethodType: 'RenderTemplate2024' as const,
    isDefault,
    inline: null,
    mediaType: null,
    mediaQuery: null,
  };
}

/** Build a minimal valid CVC catalogue entry. */
function buildCvcCatalogue(id = ID_CVC_CATALOGUE, version = '1.0.0') {
  return {
    id,
    name: 'Test Catalogue',
    version,
    endpointUrl: 'https://example.com/cvc.jsonld',
  };
}

/** Build a minimal valid manifest (no entities). */
function emptyManifest(): CustomSeedManifest {
  return {
    registrars: [],
    dataModels: [],
    renderTemplates: [],
    cvcCatalogues: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('validateManifestReferences', () => {
  // ── Valid manifest ─────────────────────────────────────────────────────────

  describe('valid manifests', () => {
    it('returns no errors for an empty manifest', () => {
      const errors = validateManifestReferences(emptyManifest(), buildCtx());
      expect(errors).toEqual([]);
    });

    it('returns no errors for a fully populated valid manifest', () => {
      const manifest: CustomSeedManifest = {
        registrars: [
          {
            id: ID_REGISTRAR,
            name: 'Test Registrar',
            namespace: 'test',
            url: 'https://example.com',
            idrServiceInstanceId: null,
            identifierSchemes: [
              {
                id: ID_SCHEME,
                name: 'Test Scheme',
                primaryKey: '01',
                validationPattern: '^\\d+$',
                linkTemplate: '/{primaryKey}/{value}',
                qualifiers: [
                  {
                    id: ID_QUALIFIER,
                    key: '10',
                    description: 'Batch number',
                    validationPattern: '^\\d+$',
                    order: 0,
                  },
                ],
              },
            ],
          },
        ],
        dataModels: [buildDataModel()],
        renderTemplates: [buildRenderTemplate()],
        cvcCatalogues: [buildCvcCatalogue()],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors).toEqual([]);
    });
  });

  // ── parentConfigId ─────────────────────────────────────────────────────────

  describe('parentConfigId validation', () => {
    it('returns an error when parentConfigId does not exist in coreDataModelIds', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL, 'cnon_existent_core_id0000000')],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('parentConfigId');
      expect(errors[0]).toContain('cnon_existent_core_id0000000');
    });

    it('accepts parentConfigId that is a core data model ID', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL, ID_CORE_MODEL)],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors).toEqual([]);
    });

    it('rejects parentConfigId that exists in allExistingDataModelIds but not in coreDataModelIds', () => {
      // ID_DB_DATA_MODEL is in allExistingDataModelIds but not in coreDataModelIds
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL, ID_DB_DATA_MODEL)],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('parentConfigId');
    });
  });

  // ── Duplicate IDs ──────────────────────────────────────────────────────────

  describe('duplicate ID detection', () => {
    it('returns an error when two data models share the same ID', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL), buildDataModel(ID_DATA_MODEL)],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      const dupErrors = errors.filter((e) => e.includes('Duplicate'));
      expect(dupErrors).toHaveLength(1);
      expect(dupErrors[0]).toContain(ID_DATA_MODEL);
    });

    it('returns an error when IDs collide across different entity types', () => {
      // Same ID used for a data model and a render template
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL)],
        renderTemplates: [buildRenderTemplate(ID_DATA_MODEL, ID_DATA_MODEL)],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      const dupErrors = errors.filter((e) => e.includes('Duplicate'));
      expect(dupErrors).toHaveLength(1);
      expect(dupErrors[0]).toContain(ID_DATA_MODEL);
    });

    it('returns an error when a registrar ID collides with a data model ID', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        registrars: [
          {
            id: ID_DATA_MODEL,
            name: 'Registrar',
            namespace: 'r',
            url: null,
            idrServiceInstanceId: null,
            identifierSchemes: [],
          },
        ],
        dataModels: [buildDataModel(ID_DATA_MODEL)],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      const dupErrors = errors.filter((e) => e.includes('Duplicate'));
      expect(dupErrors).toHaveLength(1);
    });

    it('returns no duplicate errors when all IDs are unique', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL), buildDataModel(ID_DATA_MODEL_2)],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      const dupErrors = errors.filter((e) => e.includes('Duplicate'));
      expect(dupErrors).toHaveLength(0);
    });
  });

  // ── Render template: file existence ───────────────────────────────────────

  describe('render template file existence', () => {
    it('returns an error when the render template file does not exist', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel()],
        renderTemplates: [buildRenderTemplate(ID_RENDER_TEMPLATE, ID_DATA_MODEL, 'missing.hbs')],
      };

      const ctx = buildCtx({ fileExists: () => false });
      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.some((e) => e.includes('does not exist'))).toBe(true);
      expect(errors.some((e) => e.includes('missing.hbs'))).toBe(true);
    });

    it('returns no file error when the file exists', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel()],
        renderTemplates: [buildRenderTemplate()],
      };

      const ctx = buildCtx({ fileExists: () => true });
      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.filter((e) => e.includes('does not exist'))).toHaveLength(0);
    });
  });

  // ── Render template: path traversal ───────────────────────────────────────

  describe('render template path traversal', () => {
    it('returns an error when the file path resolves outside mountDir', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel()],
        renderTemplates: [buildRenderTemplate(ID_RENDER_TEMPLATE, ID_DATA_MODEL, '../../../etc/passwd')],
      };

      const ctx = buildCtx({
        // resolvePath returns a path outside mountDir
        resolvePath: (relativePath) => path.resolve('/etc', relativePath),
        fileExists: () => true,
      });

      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.some((e) => e.includes('path traversal') || e.includes('outside the mount'))).toBe(true);
    });

    it('does not flag a safe path within mountDir', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel()],
        renderTemplates: [buildRenderTemplate()],
      };

      const ctx = buildCtx({
        resolvePath: (relativePath) => path.join(MOUNT_DIR, relativePath),
        fileExists: () => true,
      });

      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.filter((e) => e.includes('path traversal') || e.includes('outside the mount'))).toHaveLength(0);
    });
  });

  // ── Render template: forward references ───────────────────────────────────

  describe('render template forward references to manifest data models', () => {
    it('allows a render template to reference a data model declared in the same manifest', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL)],
        renderTemplates: [buildRenderTemplate(ID_RENDER_TEMPLATE, ID_DATA_MODEL)],
      };

      // The data model is NOT in allExistingDataModelIds — it is only in the manifest
      const ctx = buildCtx({
        allExistingDataModelIds: new Set([ID_CORE_MODEL]),
      });

      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.filter((e) => e.includes('unknown dataModelId'))).toHaveLength(0);
    });

    it('allows a render template to reference an existing DB data model not in manifest', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        // No data models in manifest
        renderTemplates: [buildRenderTemplate(ID_RENDER_TEMPLATE, ID_DB_DATA_MODEL)],
      };

      const ctx = buildCtx();
      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.filter((e) => e.includes('unknown dataModelId'))).toHaveLength(0);
    });

    it('returns an error when dataModelId is not in manifest or DB', () => {
      const unknownId = 'cnon_existent_data_model0000';
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        renderTemplates: [buildRenderTemplate(ID_RENDER_TEMPLATE, unknownId)],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors.some((e) => e.includes('unknown dataModelId'))).toBe(true);
      expect(errors.some((e) => e.includes(unknownId))).toBe(true);
    });
  });

  // ── Non-system-tenant ID collision ────────────────────────────────────────

  describe('non-system-tenant ID collision', () => {
    it('returns an error when a data model ID exists in a non-system tenant', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel()],
      };

      const ctx = buildCtx({
        isNonSystemCollision: (id) => id === ID_DATA_MODEL,
      });

      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.some((e) => e.includes('non-system tenant') && e.includes(ID_DATA_MODEL))).toBe(true);
    });

    it('returns an error when a render template ID exists in a non-system tenant', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel()],
        renderTemplates: [buildRenderTemplate()],
      };

      const ctx = buildCtx({
        isNonSystemCollision: (id) => id === ID_RENDER_TEMPLATE,
      });

      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.some((e) => e.includes('non-system tenant') && e.includes(ID_RENDER_TEMPLATE))).toBe(true);
    });

    it('returns an error when a CVC catalogue ID exists in a non-system tenant', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        cvcCatalogues: [buildCvcCatalogue()],
      };

      const ctx = buildCtx({
        isNonSystemCollision: (id) => id === ID_CVC_CATALOGUE,
      });

      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.some((e) => e.includes('non-system tenant') && e.includes(ID_CVC_CATALOGUE))).toBe(true);
    });
  });

  // ── System-tenant upsert (no collision) ───────────────────────────────────

  describe('system-tenant upsert (no collision)', () => {
    it('does not return a collision error when isNonSystemCollision returns false', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel()],
        renderTemplates: [buildRenderTemplate()],
        cvcCatalogues: [buildCvcCatalogue()],
      };

      const ctx = buildCtx({ isNonSystemCollision: () => false });
      const errors = validateManifestReferences(manifest, ctx);
      expect(errors.filter((e) => e.includes('non-system tenant'))).toHaveLength(0);
    });
  });

  // ── isDefault uniqueness ───────────────────────────────────────────────────

  describe('isDefault uniqueness per dataModelId', () => {
    it('returns an error when two templates share isDefault:true for the same dataModelId', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL)],
        renderTemplates: [
          buildRenderTemplate(ID_RENDER_TEMPLATE, ID_DATA_MODEL, 'a.hbs', true),
          buildRenderTemplate(ID_RENDER_TEMPLATE_2, ID_DATA_MODEL, 'b.hbs', true),
        ],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors.some((e) => e.includes('isDefault') || e.includes('default'))).toBe(true);
      expect(errors.some((e) => e.includes(ID_DATA_MODEL))).toBe(true);
    });

    it('allows exactly one isDefault:true per dataModelId', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL)],
        renderTemplates: [
          buildRenderTemplate(ID_RENDER_TEMPLATE, ID_DATA_MODEL, 'a.hbs', true),
          buildRenderTemplate(ID_RENDER_TEMPLATE_2, ID_DATA_MODEL, 'b.hbs', false),
        ],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(
        errors.filter((e) => e.includes('isDefault') || (e.includes('default') && e.includes(ID_DATA_MODEL))),
      ).toHaveLength(0);
    });

    it('allows one isDefault:true per distinct dataModelId', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [buildDataModel(ID_DATA_MODEL), buildDataModel(ID_DATA_MODEL_2)],
        renderTemplates: [
          buildRenderTemplate(ID_RENDER_TEMPLATE, ID_DATA_MODEL, 'a.hbs', true),
          buildRenderTemplate(ID_RENDER_TEMPLATE_2, ID_DATA_MODEL_2, 'b.hbs', true),
        ],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      const defaultErrors = errors.filter((e) => e.includes('Multiple render templates'));
      expect(defaultErrors).toHaveLength(0);
    });
  });

  // ── CVC version ───────────────────────────────────────────────────────────

  describe('CVC version validation', () => {
    it('returns an error when the CVC version is not supported', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        cvcCatalogues: [buildCvcCatalogue(ID_CVC_CATALOGUE, '9.9.9')],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors.some((e) => e.includes('unsupported version') && e.includes('9.9.9'))).toBe(true);
    });

    it('accepts a supported CVC version', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        cvcCatalogues: [buildCvcCatalogue(ID_CVC_CATALOGUE, '1.0.0')],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors.filter((e) => e.includes('unsupported version'))).toHaveLength(0);
    });

    it('accepts all supported CVC versions', () => {
      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        cvcCatalogues: [buildCvcCatalogue(ID_CVC_CATALOGUE, '1.1.0')],
      };

      const errors = validateManifestReferences(manifest, buildCtx());
      expect(errors.filter((e) => e.includes('unsupported version'))).toHaveLength(0);
    });
  });

  // ── Multiple errors collected ──────────────────────────────────────────────

  describe('multiple errors collected', () => {
    it('collects all errors without stopping at the first', () => {
      const badParentId = 'cnon_existent_core_id0000000';
      const badDataModelRef = 'cnon_existent_data_model0000';

      const manifest: CustomSeedManifest = {
        ...emptyManifest(),
        dataModels: [
          // Error 1: bad parentConfigId
          buildDataModel(ID_DATA_MODEL, badParentId),
          // Error 2: duplicate ID (same as ID_DATA_MODEL above)
          buildDataModel(ID_DATA_MODEL, ID_CORE_MODEL),
        ],
        renderTemplates: [
          // Error 3: unknown dataModelId
          buildRenderTemplate(ID_RENDER_TEMPLATE, badDataModelRef, 'tmpl.hbs'),
          // Error 4: file does not exist
          buildRenderTemplate(ID_RENDER_TEMPLATE_2, ID_DATA_MODEL, 'missing.hbs'),
          // Error 5: two defaults for same data model
          buildRenderTemplate(ID_CVC_CATALOGUE, ID_DATA_MODEL, 'extra.hbs', true),
        ],
        cvcCatalogues: [
          // Error 6: unsupported version
          buildCvcCatalogue(ID_REGISTRAR, '9.9.9'),
        ],
      };

      const ctx = buildCtx({
        fileExists: (p) => !p.includes('missing.hbs'),
        // ID_RENDER_TEMPLATE_2 triggers isDefault duplicate (2 defaults for ID_DATA_MODEL)
      });

      const errors = validateManifestReferences(manifest, ctx);
      // We should get multiple errors — at least 4 distinct issues
      expect(errors.length).toBeGreaterThanOrEqual(4);

      // Verify specific errors are present
      expect(errors.some((e) => e.includes('Duplicate'))).toBe(true);
      expect(errors.some((e) => e.includes('parentConfigId'))).toBe(true);
      expect(errors.some((e) => e.includes('unknown dataModelId'))).toBe(true);
      expect(errors.some((e) => e.includes('unsupported version'))).toBe(true);
    });
  });
});
