import { createRigClient, truncateApplicationTables } from './rig/db';
import { seedSystemTenant, bootManifest, SYSTEM_TENANT_ID } from './fixtures';
import { ReconcileBlockedError } from '../../prisma/custom-seed-reconcile';
import { convergeCoreProvenance } from '../../prisma/core-seed-provenance';
import { RecordSource } from '../../src/lib/prisma/generated/index.js';

const REGISTRAR_ID = 'ctestregistrar00000000001';
const SCHEME_ID = 'ctestscheme00000000000001';
const QUALIFIER_ID = 'ctestqualifier00000000001';
const OTHER_TENANT_ID = 'ctestothertenant000000001';

const prisma = createRigClient();

const FULL_MANIFEST = `
registrars:
  - id: ${REGISTRAR_ID}
    name: Test Registrar
    namespace: testreg
    identifierSchemes:
      - id: ${SCHEME_ID}
        name: Test Scheme
        primaryKey: "01"
        validationPattern: "^\\\\d{13}$"
        linkTemplate: "/{primaryKey}/{value}"
        qualifiers:
          - id: ${QUALIFIER_ID}
            key: "10"
            description: Batch number
            validationPattern: ".*"
`;

function runManifest(yaml: string): Promise<void> {
  return bootManifest(prisma, yaml);
}

beforeEach(async () => {
  await truncateApplicationTables(prisma);
  await seedSystemTenant(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('custom-seed reconcile against real Postgres', () => {
  it('seeds registrar, scheme, and qualifier, all stamped CUSTOM_SEED', async () => {
    await runManifest(FULL_MANIFEST);

    const registrar = await prisma.registrar.findUniqueOrThrow({ where: { id: REGISTRAR_ID } });
    expect(registrar.source).toBe(RecordSource.CUSTOM_SEED);
    expect(await prisma.identifierScheme.count()).toBe(1);
    expect(await prisma.schemeQualifier.count()).toBe(1);
  });

  it('absent registrars key leaves previously seeded rows unmanaged', async () => {
    await runManifest(FULL_MANIFEST);
    await runManifest(`
dataModels: []
`);
    expect(await prisma.registrar.count()).toBe(1);
    expect(await prisma.identifierScheme.count()).toBe(1);
  });

  it('explicit empty registrars array removes all manifest-owned rows of that type', async () => {
    await runManifest(FULL_MANIFEST);
    await runManifest(`
registrars: []
`);
    expect(await prisma.registrar.count()).toBe(0);
    expect(await prisma.identifierScheme.count()).toBe(0);
    expect(await prisma.schemeQualifier.count()).toBe(0);
  });

  it('a whole-empty manifest (no section keys) is a no-op guard, not a wipe', async () => {
    await runManifest(FULL_MANIFEST);
    await runManifest(`{}\n`);
    expect(await prisma.registrar.count()).toBe(1);
  });

  it("removal cascading into another tenant's scheme is refused and the transaction rolls back", async () => {
    await runManifest(FULL_MANIFEST);
    await prisma.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other' } });
    await prisma.identifierScheme.create({
      data: {
        id: 'ctestforeignscheme0000001',
        tenantId: OTHER_TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'Foreign Scheme',
        primaryKey: '02',
        validationPattern: '.*',
        linkTemplate: '/{primaryKey}/{value}',
        source: RecordSource.USER,
      },
    });

    await expect(runManifest(`\nregistrars: []\n`)).rejects.toThrow(ReconcileBlockedError);

    // Rollback: the manifest-owned rows are still present, nothing was deleted.
    expect(await prisma.registrar.count()).toBe(1);
    expect(await prisma.identifierScheme.count()).toBe(2);
  });

  it('registered identifiers block scheme removal with the identifier count named', async () => {
    await runManifest(FULL_MANIFEST);
    await prisma.identifier.create({
      data: { tenantId: SYSTEM_TENANT_ID, schemeId: SCHEME_ID, value: '9506000134352' },
    });

    let caught: ReconcileBlockedError | undefined;
    await runManifest(`\nregistrars: []\n`).catch((err) => {
      caught = err as ReconcileBlockedError;
    });
    expect(caught).toBeInstanceOf(ReconcileBlockedError);
    expect(caught!.problems.join('\n')).toContain('1 registered identifier');
    expect(await prisma.identifierScheme.count()).toBe(1);
    expect(await prisma.identifier.count()).toBe(1);
  });

  it('a non-owned render template blocks data-model removal', async () => {
    // A manifest-owned data model (created directly: the manifest schema only
    // expresses extensions, and provenance is what the reconcile keys on).
    const parent = await prisma.dataModel.create({
      data: {
        tenantId: SYSTEM_TENANT_ID,
        name: 'Core Parent',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        isExtension: false,
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        source: RecordSource.CORE_SEED,
      },
    });
    const owned = await prisma.dataModel.create({
      data: {
        id: 'ctestowneddatamodel000001',
        tenantId: SYSTEM_TENANT_ID,
        name: 'Owned Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        isExtension: true,
        parentConfigId: parent.id,
        schemaUrl: 'https://example.com/ext.json',
        contextUrl: 'https://example.com/ext-context.jsonld',
        source: RecordSource.CUSTOM_SEED,
      },
    });
    await prisma.renderTemplate.create({
      data: {
        tenantId: SYSTEM_TENANT_ID,
        dataModelId: owned.id,
        name: 'User Template',
        storageUrl: 'https://example.com/template',
        digestMultibase: 'zTESTdigest',
        renderMethodType: 'RenderTemplate2024',
        source: RecordSource.USER,
      },
    });

    await expect(runManifest(`\ndataModels: []\n`)).rejects.toThrow(ReconcileBlockedError);
    expect(await prisma.dataModel.count()).toBe(2);
    expect(await prisma.renderTemplate.count()).toBe(1);
  });

  it('reparenting a scheme and removing its old registrar in one boot keeps the child', async () => {
    await runManifest(FULL_MANIFEST);
    const NEW_REGISTRAR_ID = 'ctestregistrar00000000002';
    await runManifest(`
registrars:
  - id: ${NEW_REGISTRAR_ID}
    name: New Registrar
    namespace: newreg
    identifierSchemes:
      - id: ${SCHEME_ID}
        name: Test Scheme
        primaryKey: "01"
        validationPattern: "^\\\\d{13}$"
        linkTemplate: "/{primaryKey}/{value}"
`);

    const scheme = await prisma.identifierScheme.findUniqueOrThrow({ where: { id: SCHEME_ID } });
    expect(scheme.registrarId).toBe(NEW_REGISTRAR_ID);
    expect(await prisma.registrar.count()).toBe(1);
    expect((await prisma.registrar.findFirstOrThrow()).id).toBe(NEW_REGISTRAR_ID);
  });

  it('a manifest id colliding with a CORE_SEED row fails validation without touching the row', async () => {
    await prisma.registrar.create({
      data: {
        id: REGISTRAR_ID,
        tenantId: SYSTEM_TENANT_ID,
        name: 'Core Registrar',
        namespace: 'core',
        source: RecordSource.CORE_SEED,
      },
    });

    // A configuration-level problem (here, a manifest id colliding with a
    // core-seeded row) is a typed CustomSeedFatalError, not a direct
    // process.exit(1): the process is terminated exclusively by
    // seed-cli.ts, never from inside the custom seed itself, so the
    // failure still reaches main()'s summary (Blocker finding 1).
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    try {
      await expect(runManifest(FULL_MANIFEST)).rejects.toThrow(/belongs to a core-seeded row/);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
    const registrar = await prisma.registrar.findUniqueOrThrow({ where: { id: REGISTRAR_ID } });
    expect(registrar.source).toBe(RecordSource.CORE_SEED);
    expect(registrar.name).toBe('Core Registrar');
  });

  it('adopts a system-tenant USER row with a matching id (legacy pre-provenance row)', async () => {
    await prisma.registrar.create({
      data: {
        id: REGISTRAR_ID,
        tenantId: SYSTEM_TENANT_ID,
        name: 'Legacy Registrar',
        namespace: 'testreg',
        source: RecordSource.USER,
      },
    });

    await runManifest(FULL_MANIFEST);

    const registrar = await prisma.registrar.findUniqueOrThrow({ where: { id: REGISTRAR_ID } });
    expect(registrar.source).toBe(RecordSource.CUSTOM_SEED);
    expect(registrar.name).toBe('Test Registrar');
  });
});

describe('nested-key presence semantics against real Postgres', () => {
  it('a retained registrar omitting the identifierSchemes key leaves its schemes unmanaged', async () => {
    await runManifest(FULL_MANIFEST);
    await runManifest(`
registrars:
  - id: ${REGISTRAR_ID}
    name: Test Registrar
    namespace: testreg
`);
    expect(await prisma.identifierScheme.count()).toBe(1);
    expect(await prisma.schemeQualifier.count()).toBe(1);
  });

  it('a retained registrar with an explicit empty identifierSchemes array removes its owned schemes', async () => {
    await runManifest(FULL_MANIFEST);
    await runManifest(`
registrars:
  - id: ${REGISTRAR_ID}
    name: Test Registrar
    namespace: testreg
    identifierSchemes: []
`);
    expect(await prisma.registrar.count()).toBe(1);
    expect(await prisma.identifierScheme.count()).toBe(0);
    expect(await prisma.schemeQualifier.count()).toBe(0);
  });

  it('a retained scheme omitting the qualifiers key leaves its qualifiers unmanaged, while an explicit empty array removes them', async () => {
    await runManifest(FULL_MANIFEST);
    const withoutQualifiersKey = `
registrars:
  - id: ${REGISTRAR_ID}
    name: Test Registrar
    namespace: testreg
    identifierSchemes:
      - id: ${SCHEME_ID}
        name: Test Scheme
        primaryKey: "01"
        validationPattern: "^\\\\d{13}$"
        linkTemplate: "/{primaryKey}/{value}"
`;
    await runManifest(withoutQualifiersKey);
    expect(await prisma.schemeQualifier.count()).toBe(1);

    await runManifest(
      withoutQualifiersKey.replace(
        'linkTemplate: "/{primaryKey}/{value}"',
        'linkTemplate: "/{primaryKey}/{value}"\n        qualifiers: []',
      ),
    );
    expect(await prisma.schemeQualifier.count()).toBe(0);
    expect(await prisma.identifierScheme.count()).toBe(1);
  });
});

describe('CORE_SEED provenance convergence against real Postgres', () => {
  it('stamps a pre-provenance USER row at a real core id, after which a manifest reusing the id is refused', async () => {
    // Production stamps DataModel (and RenderTemplate) rows only, so the
    // scenario uses the real ConformityScheme data-model core id from
    // seed.ts and the matching delegate. First, a pre-provenance database:
    // the core row exists but is still labelled USER (created before the
    // source column existed).
    const CORE_DATA_MODEL_ID = 'c4fxk5o3sqrm6n0u7c7akm0sb';
    await prisma.dataModel.create({
      data: {
        id: CORE_DATA_MODEL_ID,
        tenantId: SYSTEM_TENANT_ID,
        name: 'ConformityScheme',
        credentialType: 'ConformityScheme',
        version: '0.7.0',
        isExtension: false,
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        source: RecordSource.USER,
      },
    });

    const converged = await convergeCoreProvenance(prisma.dataModel, CORE_DATA_MODEL_ID, RecordSource.USER);
    expect(converged).toBe(true);
    const row = await prisma.dataModel.findUniqueOrThrow({ where: { id: CORE_DATA_MODEL_ID } });
    expect(row.source).toBe(RecordSource.CORE_SEED);

    // Without the stamp this manifest would have adopted the row (the
    // legacy-adoption rule); with it, the reuse is refused loudly and the
    // row is untouched.
    const manifest = `
dataModels:
  - id: ${CORE_DATA_MODEL_ID}
    name: Hijacked Extension
    credentialType: ConformityScheme
    version: "0.7.0"
    parentConfigId: ${CORE_DATA_MODEL_ID}
    schemaUrl: https://example.com/hijack.json
    contextUrl: https://example.com/hijack-context.jsonld
`;
    // See the earlier collision test's comment: this is a typed
    // CustomSeedFatalError, not a direct process.exit(1) (Blocker finding 1).
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    try {
      await expect(runManifest(manifest)).rejects.toThrow(/belongs to a core-seeded row/);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
    const after = await prisma.dataModel.findUniqueOrThrow({ where: { id: CORE_DATA_MODEL_ID } });
    expect(after.name).toBe('ConformityScheme');
    expect(after.source).toBe(RecordSource.CORE_SEED);
  });
});

describe('top-level dataModels presence semantics', () => {
  const coreParent = () =>
    prisma.dataModel.create({
      data: {
        tenantId: SYSTEM_TENANT_ID,
        name: 'Core Parent',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        isExtension: false,
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        source: RecordSource.CORE_SEED,
      },
    });
  const ownedExtension = (parentId: string) =>
    prisma.dataModel.create({
      data: {
        id: 'ctestowneddatamodel000002',
        tenantId: SYSTEM_TENANT_ID,
        name: 'Owned Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        isExtension: true,
        parentConfigId: parentId,
        schemaUrl: 'https://example.com/ext.json',
        contextUrl: 'https://example.com/ext-context.jsonld',
        source: RecordSource.CUSTOM_SEED,
      },
    });

  it('an absent dataModels key leaves a manifest-owned extension untouched', async () => {
    const parent = await coreParent();
    await ownedExtension(parent.id);

    await runManifest(`\nregistrars: []\n`);

    expect(await prisma.dataModel.count()).toBe(2);
  });

  it('an explicit empty dataModels array removes an unblocked manifest-owned extension, core rows untouched', async () => {
    const parent = await coreParent();
    await ownedExtension(parent.id);

    await runManifest(`\ndataModels: []\n`);

    const remaining = await prisma.dataModel.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].source).toBe(RecordSource.CORE_SEED);
  });
});
