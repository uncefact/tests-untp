import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { SYSTEM_TENANT_ID } from './fixtures';
import { main as runSeedMain, prisma as seedPrisma, logger as seedLogger } from '../../prisma/seed';
import { SeedConfigurationError, type SeedRunSummary } from '../../prisma/seed-preflight';

/**
 * Drives the real seed's decision path (ADR-043) — `main()` from
 * `prisma/seed.ts`, the same function the CLI entrypoint calls — directly
 * against the rig database, with a deliberately incomplete environment.
 *
 * This does not go through a child process. `prisma/` is ESM-scoped (its
 * own `package.json`) while `src/` is not, and a raw `tsx prisma/seed.ts`
 * subprocess crossing that boundary depends on a marker the production
 * Dockerfile writes at build time; this test environment doesn't reproduce
 * that step, and `tsx` mis-resolves the cross-boundary named imports as a
 * result. Jest's own module loader has no such boundary, so importing and
 * calling `main()` exercises the identical preflight-then-execute logic
 * without it. The process-level contract this sidesteps — a non-zero exit
 * code from `tsx prisma/seed.ts`, and `set -e` in the entrypoint refusing
 * to start the container — is covered by manual container validation
 * rather than by this suite.
 */
const SEED_CONFIG_VARS = [
  'DATA_ENCRYPTION_KEY',
  'SERVICE_ENCRYPTION_KEY',
  'SYSTEM_IDR_ADAPTER_TYPE',
  'SYSTEM_IDR_BASE_URL',
  'SYSTEM_IDR_API_KEY',
  'SYSTEM_IDR_API_VERSION',
  'SYSTEM_IDR_DEFAULT_LINK_TYPE',
  'SYSTEM_IDR_DEFAULT_MIME_TYPE',
  'SYSTEM_IDR_DEFAULT_LANGUAGE',
  'SYSTEM_IDR_DEFAULT_CONTEXT',
  'SYSTEM_IDR_DEFAULT_FWQS',
  'SYSTEM_STORAGE_ADAPTER_TYPE',
  'SYSTEM_STORAGE_BASE_URL',
  'SYSTEM_STORAGE_API_KEY',
  'SYSTEM_STORAGE_API_VERSION',
  'SYSTEM_STORAGE_PUBLIC_BUCKET',
  'SYSTEM_STORAGE_PRIVATE_BUCKET',
  'SYSTEM_VC_ADAPTER_TYPE',
  'SYSTEM_VC_BASE_URL',
  'SYSTEM_VC_API_KEY',
  'SYSTEM_VC_API_VERSION',
  'SYSTEM_DID',
  'SYSTEM_DID_KEY_ID',
  'SEED_ALLOW_PARTIAL',
  'DEPLOYMENT_ENVIRONMENT',
];

/**
 * Runs `fn` with `process.env` set to exactly the seed-relevant variables
 * this test controls (everything else the outer process already has stays
 * put), then restores every touched variable afterwards, so one test's
 * environment can never leak into the next.
 */
async function withSeedEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map(SEED_CONFIG_VARS.map((key) => [key, process.env[key]]));
  for (const key of SEED_CONFIG_VARS) delete process.env[key];
  process.env.SKIP_CUSTOM_SEED = 'true';
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.SKIP_CUSTOM_SEED;
  }
}

type SeedModule = typeof import('../../prisma/seed');

/**
 * `seed.ts` resolves DATA_ENCRYPTION_KEY once at module load (so a
 * divergent DATA_ENCRYPTION_KEY / SERVICE_ENCRYPTION_KEY throws before
 * anything else runs, not partway through), which means the encryption
 * key `main()` actually uses cannot be changed by setting the environment
 * variable after the module the test file imports at the top has already
 * loaded. A scenario that needs a real encryption key therefore resets
 * Jest's module registry and re-imports `seed.ts` fresh, inside the same
 * environment window `withSeedEnv` opens, so this one load picks up the
 * key. The resulting module's own `main`, `prisma` and `logger` are
 * distinct objects from the ones imported at the top of this file (a
 * fresh class per reset also means its errors are not `instanceof` the
 * classes imported at the top, hence checking error identity by `.name`
 * rather than `instanceof` in the tests that use this).
 */
async function withFreshSeedModule<T>(
  overrides: Record<string, string>,
  fn: (seedModule: SeedModule) => Promise<T>,
): Promise<T> {
  return withSeedEnv(overrides, async () => {
    jest.resetModules();
    const seedModule = await import('../../prisma/seed');
    try {
      return await fn(seedModule);
    } finally {
      await seedModule.prisma.$disconnect();
    }
  });
}

describe('seed.ts: fails loudly on missing configuration (ADR-043)', () => {
  const prisma = createRigClient();

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await seedPrisma.$disconnect();
  });

  it('default mode: aborts before any write, naming every missing variable and the opt-out', async () => {
    let caught: SeedConfigurationError | undefined;
    try {
      await withSeedEnv({}, runSeedMain);
    } catch (error) {
      caught = error as SeedConfigurationError;
    }
    expect(caught).toBeInstanceOf(SeedConfigurationError);
    expect(caught!.message).toMatch(/SEED_ALLOW_PARTIAL=true/);
    expect(caught!.summary.categoriesNotRun.sort()).toEqual(
      ['did', 'idr', 'renderTemplates', 'storage', 'vc', 'tenant', 'dataModels', 'customSeed'].sort(),
    );
    expect(Object.keys(caught!.summary.missingVariables)).toEqual(
      expect.arrayContaining(['encryption', 'idr', 'storage', 'vc', 'did', 'renderTemplates']),
    );

    // Every mention of a category the seed would otherwise have written is
    // in the summary, but nothing actually reached the database — not even
    // the system tenant, which carries no gated configuration itself.
    expect(await prisma.tenant.count()).toBe(0);
    expect(await prisma.serviceInstance.count()).toBe(0);
    expect(await prisma.did.count()).toBe(0);
    expect(await prisma.renderTemplate.count()).toBe(0);
  });

  it('default mode: a divergent encryption key alongside an unrelated missing variable names BOTH in the abort message (Major finding 2)', async () => {
    // Before this fix, the preflight abort message and its `otherIssuesByCategory`
    // dropped a divergent DATA_ENCRYPTION_KEY/SERVICE_ENCRYPTION_KEY pair
    // entirely whenever an unrelated category (here, SYSTEM_IDR_BASE_URL)
    // was the one that actually triggered `hasMissing`. Both problems must
    // be visible in the same boot cycle.
    let caught: SeedConfigurationError | undefined;
    try {
      await withSeedEnv(
        {
          DATA_ENCRYPTION_KEY: 'key-one',
          SERVICE_ENCRYPTION_KEY: 'key-two',
        },
        runSeedMain,
      );
    } catch (error) {
      caught = error as SeedConfigurationError;
    }
    expect(caught).toBeInstanceOf(SeedConfigurationError);
    expect(caught!.message).toMatch(/idr: SYSTEM_IDR_BASE_URL/);
    expect(caught!.message).toMatch(/encryption: DATA_ENCRYPTION_KEY and SERVICE_ENCRYPTION_KEY are both set/);
    expect(caught!.summary.invalidSiblings.encryption).toMatch(/both set with different values/);
    expect(await prisma.tenant.count()).toBe(0);
  });

  it('default mode: main() itself logs nothing before throwing, so the one caller who logs the caught error does not double the summary (BLOCKER 2a)', async () => {
    // `SeedConfigurationError` already carries the summary as `.summary`,
    // and the one real caller (seed-cli.ts) logs the caught error with
    // pino, whose default err serializer expands every own property —
    // including `.summary` — into the log line. If `main()` ALSO logged
    // the summary itself before throwing, an operator would see the same
    // summary twice for one run, which is exactly what this test guards
    // against by asserting `main()` logs nothing on this path.
    const errorSpy = jest.spyOn(seedLogger, 'error');
    try {
      await expect(withSeedEnv({}, runSeedMain)).rejects.toBeInstanceOf(SeedConfigurationError);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a divergent DATA_ENCRYPTION_KEY / SERVICE_ENCRYPTION_KEY still emits the summary once, rather than an uncaught exception with none at all (BLOCKER 2b)', async () => {
    // resolveDataEncryptionKey() used to run at module load, before main()
    // (and its try/catch) existed, so this failure was an unhandled
    // exception at import time with no summary and no structured log at
    // all. It now runs as the first statement inside main()'s try block,
    // so the same mid-run failure handling that covers every other
    // interruption covers this one too.
    let caught: unknown;
    let errorCalls: unknown[][] = [];

    await withFreshSeedModule(
      {
        DATA_ENCRYPTION_KEY: 'a-real-key',
        SERVICE_ENCRYPTION_KEY: 'a-different-key',
        SEED_ALLOW_PARTIAL: 'true',
      },
      async (seedModule) => {
        const errorSpy = jest.spyOn(seedModule.logger, 'error');
        try {
          await seedModule.main();
        } catch (error) {
          caught = error;
        } finally {
          errorCalls = errorSpy.mock.calls as unknown[][];
          errorSpy.mockRestore();
        }
      },
    );

    expect((caught as Error)?.message).toMatch(
      /DATA_ENCRYPTION_KEY and SERVICE_ENCRYPTION_KEY are both set with different values/,
    );
    expect((caught as Error)?.name).not.toBe('SeedConfigurationError');

    const summaryCall = errorCalls.find(
      ([, message]) => message === 'Seed failed partway through; the summary reflects what did complete',
    );
    expect(summaryCall).toBeDefined();
    const [{ summary }] = summaryCall as [{ summary: SeedRunSummary }, string];
    // The throw happens before even the tenant upsert, so nothing ran.
    expect(summary.categoriesSeeded).toEqual([]);
    expect(await prisma.tenant.count()).toBe(0);
  });

  it('SEED_ALLOW_PARTIAL=true, nothing configured: tenant and data models still seed, everything gated stays absent', async () => {
    await withSeedEnv({ SEED_ALLOW_PARTIAL: 'true' }, runSeedMain);

    // The system tenant and data models carry no gated configuration, so
    // they seed regardless of what's missing.
    expect(await prisma.tenant.count({ where: { id: SYSTEM_TENANT_ID } })).toBe(1);
    expect(await prisma.dataModel.count()).toBeGreaterThan(0);

    // Every category gated on DATA_ENCRYPTION_KEY (unset) or SYSTEM_DID
    // (unset) is absent.
    expect(await prisma.serviceInstance.count()).toBe(0);
    expect(await prisma.did.count()).toBe(0);
    expect(await prisma.renderTemplate.count()).toBe(0);
  });

  it('SEED_ALLOW_PARTIAL=true: a category with everything IT needs configured actually seeds, proving the encryption gate genuinely responds to DATA_ENCRYPTION_KEY rather than passing for an unrelated reason', async () => {
    // DATA_ENCRYPTION_KEY is resolved once at module load (see
    // `withFreshSeedModule`'s doc comment), so this scenario needs the
    // fresh-module path: only that guarantees the real key this test sets
    // is the one `main()` actually uses, rather than whatever was resolved
    // before this test file's top-level import ran (typically nothing).
    await withFreshSeedModule(
      {
        SEED_ALLOW_PARTIAL: 'true',
        DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
        SYSTEM_IDR_BASE_URL: 'https://idr.example.com',
        SYSTEM_IDR_API_KEY: 'idr-key',
        SYSTEM_IDR_DEFAULT_LINK_TYPE: 'untp:dpp',
        SYSTEM_IDR_DEFAULT_MIME_TYPE: 'text/html',
        SYSTEM_IDR_DEFAULT_LANGUAGE: 'en',
        SYSTEM_IDR_DEFAULT_CONTEXT: 'au',
      },
      (seedModule) => seedModule.main(),
    );

    // IDR is both eligible (its own variables are fully configured) and
    // ungated (a real key was resolved), so it seeds. This is the half of
    // "executes the eligible categories" the previous version of this test
    // never actually exercised: with DATA_ENCRYPTION_KEY frozen at import
    // time, IDR was skipped by its own missing variables regardless of
    // what the encryption gate did, so the assertion held for the wrong
    // reason and would not have caught the gate always resolving 'ok'.
    expect(await prisma.serviceInstance.count({ where: { serviceType: 'IDR' } })).toBe(1);

    // VC, storage, and DID are still gated by their own missing variables.
    expect(await prisma.serviceInstance.count({ where: { serviceType: { not: 'IDR' } } })).toBe(0);
    expect(await prisma.did.count()).toBe(0);
    expect(await prisma.renderTemplate.count()).toBe(0);
  });

  it('SEED_ALLOW_PARTIAL=true: a fully configured category still does not seed when DATA_ENCRYPTION_KEY itself is missing (the gate, not its own variables)', async () => {
    // The mirror image of the previous test: IDR's own variables are
    // complete, but DATA_ENCRYPTION_KEY is absent. If the encryption gate
    // were broken (for example `if (ENCRYPTION_KEY)` mutated to always
    // true), IDR would seed here despite no key ever being configured;
    // this is what makes the gate itself, not just IDR's own schema, the
    // thing under test.
    await withFreshSeedModule(
      {
        SEED_ALLOW_PARTIAL: 'true',
        SYSTEM_IDR_BASE_URL: 'https://idr.example.com',
        SYSTEM_IDR_API_KEY: 'idr-key',
        SYSTEM_IDR_DEFAULT_LINK_TYPE: 'untp:dpp',
        SYSTEM_IDR_DEFAULT_MIME_TYPE: 'text/html',
        SYSTEM_IDR_DEFAULT_LANGUAGE: 'en',
        SYSTEM_IDR_DEFAULT_CONTEXT: 'au',
      },
      (seedModule) => seedModule.main(),
    );

    expect(await prisma.serviceInstance.count()).toBe(0);
  });

  it('a mid-run failure after preflight passed still emits the summary once and propagates the original error', async () => {
    // A placeholder DATA_ENCRYPTION_KEY outside local development is an
    // operational failure the preflight does not check for (it only checks
    // the variable is present), so it throws from inside main() itself,
    // after the tenant has already been upserted. ADR-043 decision 2 keeps
    // this failure's own behaviour unchanged; this test only checks that
    // the summary the seed builds around it is honest and that the
    // original error is not swallowed.
    let caught: unknown;
    let errorCalls: unknown[][] = [];

    await withFreshSeedModule(
      {
        SEED_ALLOW_PARTIAL: 'true',
        DATA_ENCRYPTION_KEY: '0'.repeat(64),
        DEPLOYMENT_ENVIRONMENT: 'production',
      },
      async (seedModule) => {
        const errorSpy = jest.spyOn(seedModule.logger, 'error');
        try {
          await seedModule.main();
        } catch (error) {
          caught = error;
        } finally {
          errorCalls = errorSpy.mock.calls as unknown[][];
          errorSpy.mockRestore();
        }
      },
    );

    // The original error propagates unmodified, not wrapped or replaced,
    // so seed-cli.ts's `.catch()` still exits non-zero for the real cause.
    // (Checked by name, not `instanceof`: this scenario needs a fresh
    // module import per `withFreshSeedModule`'s own doc comment, so the
    // error class here is not the one imported at the top of this file.)
    expect((caught as Error)?.name).toBe('PlaceholderEncryptionKeyError');
    expect((caught as Error)?.name).not.toBe('SeedConfigurationError');

    // The summary is built and logged from whatever state existed at the
    // moment of failure: nothing under `preflight.hasMissing` blocked this
    // run (SEED_ALLOW_PARTIAL=true), and the tenant upsert (the very first
    // statement in the try block) already completed before the throw, so
    // it correctly reads 'seeded' — a real side effect already happened.
    // The throw happens before the run reaches any later category's own
    // gate check, so every one of them is 'notRun' rather than 'skipped'
    // (Moderate finding 6: 'skipped' is reserved for a category the run
    // actually reached and decided not to run).
    const summaryCall = errorCalls.find(
      ([, message]) => message === 'Seed failed partway through; the summary reflects what did complete',
    );
    expect(summaryCall).toBeDefined();
    const [{ summary }] = summaryCall as [{ summary: SeedRunSummary }, string];
    expect(summary.categoriesSeeded).toEqual(['tenant']);
    expect(summary.categoriesSkipped).toEqual([]);
    expect(summary.categoriesNotRun.sort()).toEqual(
      ['did', 'idr', 'renderTemplates', 'storage', 'vc', 'dataModels', 'customSeed'].sort(),
    );

    // The tenant upsert ran before the throw and is not rolled back (the
    // seed is not transactional; ADR-043's consequences section says so).
    expect(await prisma.tenant.count({ where: { id: SYSTEM_TENANT_ID } })).toBe(1);
    expect(await prisma.serviceInstance.count()).toBe(0);
  });

  it('renderTemplates reports partial when every template file is missing (the category ran, but produced nothing)', async () => {
    // TEMPLATES_BASE resolves relative to `scriptDir`, which under a test
    // runner is not prisma/'s real directory (see seed.ts's own comment on
    // `scriptDir`), so every core data model's template file reads as
    // missing here without any file-system manipulation.
    let warnCalls: unknown[][] = [];

    await withFreshSeedModule(
      {
        SEED_ALLOW_PARTIAL: 'true',
        DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
        SYSTEM_STORAGE_BASE_URL: 'http://127.0.0.1:1',
        SYSTEM_STORAGE_PUBLIC_BUCKET: 'public',
        SYSTEM_STORAGE_PRIVATE_BUCKET: 'private',
      },
      async (seedModule) => {
        const warnSpy = jest.spyOn(seedModule.logger, 'warn');
        try {
          await seedModule.main();
        } finally {
          warnCalls = warnSpy.mock.calls as unknown[][];
          warnSpy.mockRestore();
        }
      },
    );

    // Every template file read as missing, so none were uploaded — the
    // category ran (the service instance seeded) but produced nothing.
    expect(await prisma.serviceInstance.count()).toBe(1);
    expect(await prisma.renderTemplate.count()).toBe(0);

    const summaryCall = warnCalls.find(
      ([, message]) => message === 'Seed complete with categories skipped or incomplete',
    );
    expect(summaryCall).toBeDefined();
    const [{ summary }] = summaryCall as [{ summary: SeedRunSummary }, string];

    // The honest claim: renderTemplates is partial, named with what was
    // skipped, and it must NOT also appear as fully seeded.
    expect(summary.categoriesPartial).toContain('renderTemplates');
    expect(summary.categoriesSeeded).not.toContain('renderTemplates');
    expect(summary.partialDetails.renderTemplates.length).toBeGreaterThan(0);
  });

  it('renderTemplates reports partial when one template genuinely uploads and a later one is missing (the real mixed case)', async () => {
    // Drives the actual mixed outcome rather than the all-missing edge
    // case above: a real storage round-trip against a loopback fixture
    // server for exactly one data model's template, with every other
    // template's file read still reporting missing (the same `scriptDir`
    // mismatch as above). `fs.existsSync`/`readFileSync` are mocked only
    // for that one path; every other call falls through to the real `fs`.
    const fixtures: FixtureServer = await startFixtureServer();
    const targetCredentialType = 'DigitalProductPassport';
    const targetVersion = '0.6.0';
    // Captured before `spyOn` replaces the shared `fs` object's own methods:
    // `jest.requireActual('node:fs')` for a Node core module returns that
    // same mutated object, not an independent unmocked copy, so calling it
    // from inside the mock implementation would recurse into itself.
    const realExistsSync = fs.existsSync.bind(fs);
    const realReadFileSync = fs.readFileSync.bind(fs);
    const existsSyncSpy = jest.spyOn(fs, 'existsSync');
    const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');

    try {
      fixtures.set('/api/v4/public', {
        contentType: 'application/json',
        body: JSON.stringify({ uri: 'https://fixture.example/blob', digestMultibase: 'zFIXTUREDIGEST' }),
      });

      const isTargetTemplatePath = (templatePath: unknown): boolean =>
        typeof templatePath === 'string' &&
        templatePath.includes('digital_product_passport') &&
        templatePath.includes(`v${targetVersion}`);

      existsSyncSpy.mockImplementation((templatePath: fs.PathLike) => {
        if (isTargetTemplatePath(templatePath)) return true;
        return realExistsSync(templatePath);
      });
      readFileSyncSpy.mockImplementation(((templatePath: fs.PathLike, options?: BufferEncoding) => {
        if (isTargetTemplatePath(templatePath)) return '<html>fixture template</html>';
        return realReadFileSync(templatePath, options);
      }) as typeof fs.readFileSync);

      let warnCalls: unknown[][] = [];
      await withFreshSeedModule(
        {
          SEED_ALLOW_PARTIAL: 'true',
          DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
          SYSTEM_STORAGE_BASE_URL: fixtures.baseUrl,
          SYSTEM_STORAGE_PUBLIC_BUCKET: 'public',
          SYSTEM_STORAGE_PRIVATE_BUCKET: 'private',
        },
        async (seedModule) => {
          const warnSpy = jest.spyOn(seedModule.logger, 'warn');
          try {
            await seedModule.main();
          } finally {
            warnCalls = warnSpy.mock.calls as unknown[][];
            warnSpy.mockRestore();
          }
        },
      );

      // Exactly one template genuinely uploaded via the fixture server.
      expect(await prisma.renderTemplate.count()).toBe(1);
      const created = await prisma.renderTemplate.findFirstOrThrow();
      expect(created.storageUrl).toBe('https://fixture.example/blob');

      const summaryCall = warnCalls.find(
        ([, message]) => message === 'Seed complete with categories skipped or incomplete',
      );
      expect(summaryCall).toBeDefined();
      const [{ summary }] = summaryCall as [{ summary: SeedRunSummary }, string];

      expect(summary.categoriesPartial).toContain('renderTemplates');
      expect(summary.categoriesSeeded).not.toContain('renderTemplates');
      // 14 of the 15 core data models' templates are still missing; only
      // the one this test made "exist" is absent from the skipped list.
      expect(summary.partialDetails.renderTemplates.length).toBe(14);
      expect(
        summary.partialDetails.renderTemplates.some(
          (detail) => detail.includes(targetCredentialType) && detail.includes(targetVersion),
        ),
      ).toBe(false);
    } finally {
      existsSyncSpy.mockRestore();
      readFileSyncSpy.mockRestore();
      await fixtures.close();
    }
  });

  it('renderTemplates reports partial, not skipped, when the storage upload succeeds but the database write then fails (Major finding 4)', async () => {
    // The upload is a real external side effect the storage service
    // cannot roll back; if the database `create` that follows throws, the
    // uploaded object is orphaned. Before this fix, `templatesCreatedCount`
    // was only incremented after the database write, so this exact
    // scenario was misreported as `renderTemplates: skipped` (as if
    // nothing had happened) instead of `partial`.
    const fixtures: FixtureServer = await startFixtureServer();
    const realExistsSync = fs.existsSync.bind(fs);
    const realReadFileSync = fs.readFileSync.bind(fs);
    const existsSyncSpy = jest.spyOn(fs, 'existsSync');
    const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');

    const isTargetTemplatePath = (templatePath: unknown): boolean =>
      typeof templatePath === 'string' &&
      templatePath.includes('digital_product_passport') &&
      templatePath.includes('v0.6.0');

    existsSyncSpy.mockImplementation((templatePath: fs.PathLike) => {
      if (isTargetTemplatePath(templatePath)) return true;
      return realExistsSync(templatePath);
    });
    readFileSyncSpy.mockImplementation(((templatePath: fs.PathLike, options?: BufferEncoding) => {
      if (isTargetTemplatePath(templatePath)) return '<html>fixture template</html>';
      return realReadFileSync(templatePath, options);
    }) as typeof fs.readFileSync);

    try {
      fixtures.set('/api/v4/public', {
        contentType: 'application/json',
        body: JSON.stringify({ uri: 'https://fixture.example/blob', digestMultibase: 'zFIXTUREDIGEST' }),
      });

      let warnCalls: unknown[][] = [];
      let errorCalls: unknown[][] = [];
      let caught: unknown;

      await withFreshSeedModule(
        {
          SEED_ALLOW_PARTIAL: 'true',
          DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
          SYSTEM_STORAGE_BASE_URL: fixtures.baseUrl,
          SYSTEM_STORAGE_PUBLIC_BUCKET: 'public',
          SYSTEM_STORAGE_PRIVATE_BUCKET: 'private',
        },
        async (seedModule) => {
          const dbFailure = new Error('simulated database write failure after upload');
          const createSpy = jest.spyOn(seedModule.prisma.renderTemplate, 'create').mockRejectedValue(dbFailure);
          const warnSpy = jest.spyOn(seedModule.logger, 'warn');
          const errorSpy = jest.spyOn(seedModule.logger, 'error');
          try {
            await seedModule.main();
          } catch (error) {
            caught = error;
          } finally {
            warnCalls = warnSpy.mock.calls as unknown[][];
            errorCalls = errorSpy.mock.calls as unknown[][];
            createSpy.mockRestore();
            warnSpy.mockRestore();
            errorSpy.mockRestore();
          }
        },
      );

      // The upload happened (the fixture recorded a request) but the row
      // never landed, so nothing exists in the database — yet the summary
      // must still say 'partial', never 'skipped', for renderTemplates.
      expect(await prisma.renderTemplate.count()).toBe(0);
      expect(caught).toBeUndefined();

      const summaryCall =
        warnCalls.find(([, message]) => message === 'Seed complete with categories skipped or incomplete') ??
        errorCalls.find(
          ([, message]) => message === 'Seed failed partway through; the summary reflects what did complete',
        );
      expect(summaryCall).toBeDefined();
      const [{ summary }] = summaryCall as [{ summary: SeedRunSummary }, string];

      expect(summary.categoriesPartial).toContain('renderTemplates');
      expect(summary.categoriesSkipped).not.toContain('renderTemplates');
    } finally {
      existsSyncSpy.mockRestore();
      readFileSyncSpy.mockRestore();
      await fixtures.close();
    }
  });

  it('renderTemplates never disagrees with itself: partialDetails and the outcome agree even when the very first upload throws', async () => {
    // Grok's remaining finding on the panel follow-up: before this fix,
    // `renderTemplateInterruptedItem` was set right before the upload
    // call, but only `templatesCreatedCount` (incremented after a
    // successful upload) and `templatesSkippedFiles` fed the outcome. If
    // the first item's own `storeBinary` call is what throws, neither of
    // those is non-empty, so the catch reported `renderTemplates: skipped`
    // while `partialDetails.renderTemplates` still named the interrupted
    // item — the outcome and its own detail disagreeing about whether the
    // category did anything. The storage base URL here points at a
    // fixture server with no upload endpoint registered, so the very
    // first `storeBinary` call fails with a 404 before anything succeeds.
    const fixtures: FixtureServer = await startFixtureServer();
    const realReadFileSync = fs.readFileSync.bind(fs);
    const existsSyncSpy = jest.spyOn(fs, 'existsSync');
    const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');

    existsSyncSpy.mockImplementation(() => true);
    readFileSyncSpy.mockImplementation(((templatePath: fs.PathLike, options?: BufferEncoding) => {
      if (typeof templatePath === 'string' && templatePath.includes('template.hbs')) {
        return '<html>fixture template</html>';
      }
      return realReadFileSync(templatePath, options);
    }) as typeof fs.readFileSync);

    try {
      let warnCalls: unknown[][] = [];
      let errorCalls: unknown[][] = [];

      await withFreshSeedModule(
        {
          SEED_ALLOW_PARTIAL: 'true',
          DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
          // No fixture registered at this base URL for any path, so the
          // very first upload attempt gets a 404 and the adapter throws
          // before any template is ever created.
          SYSTEM_STORAGE_BASE_URL: fixtures.baseUrl,
          SYSTEM_STORAGE_PUBLIC_BUCKET: 'public',
          SYSTEM_STORAGE_PRIVATE_BUCKET: 'private',
        },
        async (seedModule) => {
          const warnSpy = jest.spyOn(seedModule.logger, 'warn');
          const errorSpy = jest.spyOn(seedModule.logger, 'error');
          try {
            await seedModule.main();
          } finally {
            warnCalls = warnSpy.mock.calls as unknown[][];
            errorCalls = errorSpy.mock.calls as unknown[][];
            warnSpy.mockRestore();
            errorSpy.mockRestore();
          }
        },
      );

      expect(await prisma.renderTemplate.count()).toBe(0);

      const summaryCall =
        warnCalls.find(([, message]) => message === 'Seed complete with categories skipped or incomplete') ??
        errorCalls.find(
          ([, message]) => message === 'Seed failed partway through; the summary reflects what did complete',
        );
      expect(summaryCall).toBeDefined();
      const [{ summary }] = summaryCall as [{ summary: SeedRunSummary }, string];

      // The core assertion: whenever renderTemplates has a detail entry,
      // it must be in categoriesPartial, never categoriesSkipped — the two
      // must never disagree about whether the category did anything.
      const hasDetail = (summary.partialDetails.renderTemplates ?? []).length > 0;
      expect(hasDetail).toBe(true);
      expect(summary.categoriesPartial).toContain('renderTemplates');
      expect(summary.categoriesSkipped).not.toContain('renderTemplates');
    } finally {
      existsSyncSpy.mockRestore();
      readFileSyncSpy.mockRestore();
      await fixtures.close();
    }
  });
});
