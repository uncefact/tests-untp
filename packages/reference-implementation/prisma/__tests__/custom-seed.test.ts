import path from 'path';
import type { CustomSeedDependencies } from '../custom-seed';

// ── Mock fs before importing the module under test ───────────────────────────

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  realpathSync: jest.fn((p: string) => p),
}));

// ── Mock yaml ────────────────────────────────────────────────────────────────

jest.mock('yaml', () => ({
  parse: jest.fn(),
}));

// ── Mock the CVC ingest entry to avoid pulling utils + undici through jest ────

jest.mock('../../src/lib/cvc/index.js', () => ({
  ingestConformityScheme: jest.fn(),
}));

jest.mock('../../src/lib/credentials/schema-loader.js', () => ({
  schemaLoader: { load: jest.fn() },
}));

// ── Mock process.exit ────────────────────────────────────────────────────────

const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit');
}) as () => never);

// ── Import after mocks ──────────────────────────────────────────────────────

import fs from 'fs';
import { parse as parseYaml } from 'yaml';
import { runCustomSeed } from '../custom-seed';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SYSTEM_TENANT_ID = 'csystem00000000000000001';
const CUSTOM_SEED_DIR = '/tmp/test-custom-seed';

/** Valid CUID v1 fixtures */
const IDS = {
  registrar1: 'cjld2cjxh0000qzrmn831i7rn',
  scheme1: 'ckabcdefghij0000klmnopqrs',
  qualifier1: 'ckabcdefghij0003klmnopqrv',
  dataModel1: 'ckabcdefghij0005klmnopqrx',
  renderTemplate1: 'ckabcdefghij0006klmnopqry',
  parentConfig: 'ckabcdefghij0009klmnopqsb',
};

function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
    fatal: jest.fn(),
    trace: jest.fn(),
    silent: jest.fn(),
    level: 'info',
  } as unknown as CustomSeedDependencies['logger'];
}

function createMockPrisma() {
  const upsertFn = jest.fn().mockResolvedValue({});
  const findManyFn = jest.fn().mockResolvedValue([]);
  const transactionFn = jest.fn().mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
    const tx = {
      registrar: { upsert: jest.fn().mockResolvedValue({}) },
      identifierScheme: { upsert: jest.fn().mockResolvedValue({}) },
      schemeQualifier: { upsert: jest.fn().mockResolvedValue({}) },
      dataModel: { upsert: jest.fn().mockResolvedValue({}) },
      renderTemplate: { upsert: jest.fn().mockResolvedValue({}) },
    };
    return fn(tx);
  });

  return {
    dataModel: { findMany: findManyFn, findFirst: jest.fn().mockResolvedValue(null) },
    registrar: { findMany: findManyFn, upsert: upsertFn },
    identifierScheme: { findMany: findManyFn, upsert: upsertFn },
    schemeQualifier: { findMany: findManyFn, upsert: upsertFn },
    renderTemplate: { findMany: findManyFn, upsert: upsertFn },
    conformityScheme: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: transactionFn,
  } as unknown as CustomSeedDependencies['prisma'];
}

function createDeps(overrides?: Partial<CustomSeedDependencies>): CustomSeedDependencies {
  return {
    logger: createMockLogger(),
    prisma: createMockPrisma(),
    systemTenantId: SYSTEM_TENANT_ID,
    customSeedDir: CUSTOM_SEED_DIR,
    storageService: null,
    storageServiceInstanceId: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExit.mockClear();
  mockExit.mockImplementation((() => {
    throw new Error('process.exit');
  }) as () => never);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runCustomSeed', () => {
  describe('when seed.yaml does not exist', () => {
    it('skips with info log and returns', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const deps = createDeps();

      await runCustomSeed(deps);

      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ manifestPath: path.join(CUSTOM_SEED_DIR, 'seed.yaml') }),
        expect.stringContaining('No custom seed manifest found'),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe('when manifest is empty (zero entities)', () => {
    it('skips with info log and returns', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('');
      (parseYaml as jest.Mock).mockReturnValue({
        registrars: [],
        dataModels: [],
        renderTemplates: [],
      });

      const deps = createDeps();

      await runCustomSeed(deps);

      expect(deps.logger.info).toHaveBeenCalledWith(expect.stringContaining('empty'));
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe('when YAML syntax is invalid', () => {
    it('exits with code 1', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('bad yaml');
      (parseYaml as jest.Mock).mockImplementation(() => {
        const err = new Error('YAML parse error');
        Object.assign(err, { linePos: [{ line: 3, col: 5 }] });
        throw err;
      });

      const deps = createDeps();

      await expect(runCustomSeed(deps)).rejects.toThrow('process.exit');

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(deps.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ line: 3, col: 5 }),
        expect.stringContaining('Failed to parse'),
      );
    });
  });

  describe('when Phase 1 validation fails (invalid CUID)', () => {
    it('exits with code 1', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('');
      (parseYaml as jest.Mock).mockReturnValue({
        registrars: [
          {
            id: 'not-a-cuid',
            name: 'Test',
            namespace: 'test',
          },
        ],
      });

      const deps = createDeps();

      await expect(runCustomSeed(deps)).rejects.toThrow('process.exit');

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(deps.logger.error).toHaveBeenCalled();
    });
  });

  describe('when storage service is unavailable for templates', () => {
    it('exits with code 1', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('');

      const manifestData = {
        registrars: [],
        dataModels: [],
        renderTemplates: [
          {
            id: IDS.renderTemplate1,
            name: 'Test Template',
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

      (parseYaml as jest.Mock).mockReturnValue(manifestData);

      // Make Phase 2 validation pass by returning the dataModelId in allExistingDataModelIds
      // and making file exist within mount dir.
      const mockPrisma = createMockPrisma();
      (mockPrisma.dataModel.findMany as jest.Mock).mockImplementation((query: Record<string, unknown>) => {
        if ((query?.where as Record<string, unknown>)?.isExtension === false) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: IDS.dataModel1 }]);
      });

      // File checks: existsSync true for manifest and template file
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.realpathSync as unknown as jest.Mock).mockImplementation((p: string) => p);

      const deps = createDeps({
        prisma: mockPrisma,
        storageService: null, // No storage service!
      });

      await expect(runCustomSeed(deps)).rejects.toThrow('process.exit');

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('storage service'));
    });
  });

  describe('conformitySchemes seed processing', () => {
    function setupManifest(conformitySchemes: unknown[]) {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p.endsWith('seed.yaml')) return '';
        return Buffer.from('{"id":"https://example.com/scheme","name":"Example"}');
      });
      (parseYaml as jest.Mock).mockReturnValue({
        registrars: [],
        dataModels: [],
        renderTemplates: [],
        conformitySchemes,
      });
    }

    it('ingests a URL-based conformity scheme entry when not already present', async () => {
      setupManifest([{ url: 'https://example.com/scheme', version: '0.7.0' }]);
      const deps = createDeps();
      const ingestMock = require('../../src/lib/cvc/index.js').ingestConformityScheme as jest.Mock;
      ingestMock.mockResolvedValue({ kind: 'success', schemeId: 'row-1' });
      (deps.prisma.dataModel.findFirst as jest.Mock).mockResolvedValue({
        schemaUrl: 'https://example.com/schema.json',
      });

      await runCustomSeed(deps);

      expect(deps.prisma.conformityScheme.findUnique).toHaveBeenCalledWith({
        where: { sourceUrl_tenantId: { sourceUrl: 'https://example.com/scheme', tenantId: SYSTEM_TENANT_ID } },
      });
      expect(ingestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: 'https://example.com/scheme',
          source: 'SYSTEM_SEED',
          tenantId: SYSTEM_TENANT_ID,
          conformitySchemaUrl: 'https://example.com/schema.json',
          conformityVocabularySpecVersion: '0.7.0',
        }),
      );
    });

    it('skips an entry whose (sourceUrl, tenantId) row already exists (insert-only-if-absent)', async () => {
      setupManifest([{ url: 'https://example.com/scheme', version: '0.7.0' }]);
      const deps = createDeps();
      const ingestMock = require('../../src/lib/cvc/index.js').ingestConformityScheme as jest.Mock;
      (deps.prisma.conformityScheme.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-row' });

      await runCustomSeed(deps);

      expect(ingestMock).not.toHaveBeenCalled();
      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ sourceUrl: 'https://example.com/scheme' }),
        expect.stringContaining('insert-only-if-absent'),
      );
    });

    it('skips an entry whose version has no ConformityScheme DataModel row', async () => {
      setupManifest([{ url: 'https://example.com/scheme', version: '9.9.9' }]);
      const deps = createDeps();
      const ingestMock = require('../../src/lib/cvc/index.js').ingestConformityScheme as jest.Mock;
      (deps.prisma.dataModel.findFirst as jest.Mock).mockResolvedValue(null);

      await runCustomSeed(deps);

      expect(ingestMock).not.toHaveBeenCalled();
      expect(deps.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ version: '9.9.9' }),
        expect.stringContaining('ConformityScheme DataModel'),
      );
    });

    it('ingests a file-based entry by reading the JSON-LD and extracting `id` as sourceUrl', async () => {
      setupManifest([{ file: 'schemes/example.json', version: '0.7.0' }]);
      const deps = createDeps();
      const ingestMock = require('../../src/lib/cvc/index.js').ingestConformityScheme as jest.Mock;
      ingestMock.mockResolvedValue({ kind: 'success', schemeId: 'row-1' });
      (deps.prisma.dataModel.findFirst as jest.Mock).mockResolvedValue({
        schemaUrl: 'https://example.com/schema.json',
      });

      await runCustomSeed(deps);

      expect(ingestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: 'https://example.com/scheme',
          source: 'SYSTEM_SEED',
          prefetched: expect.objectContaining({ body: expect.any(Uint8Array) }),
        }),
      );
    });
  });
});
