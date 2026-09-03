import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LoggerService as Logger } from '@uncefact/untp-ri-services';
import type { PrismaClient } from '../../src/lib/prisma/generated/index.js';
import { LibraryRecordOrigin, RecordSource } from '../../src/lib/prisma/generated/index.js';
import type {
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
} from '../../src/lib/prisma/generated/index.js';
import { SYSTEM_TENANT_ID } from '../../src/lib/prisma/constants';
import { runCustomSeed, type CustomSeedDependencies } from '../../prisma/custom-seed';
import type { FixtureServer } from './rig/fixture-server';

export { SYSTEM_TENANT_ID };

/**
 * Structured-logger stub satisfying the seed's LoggerService surface.
 * Error-level output always reaches the console: several production paths
 * log-and-continue rather than throw, and swallowing those would leave an
 * error-logged regression invisible in CI. Suites that deliberately drive a
 * failure path will print that failure's log line; that noise is the
 * visibility working as intended.
 */
export function quietLogger(): Logger {
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: (...args: unknown[]) => console.error('[seed error]', ...args),
    debug: () => undefined,
    child: () => logger,
  };
  return logger as unknown as Logger;
}

/** Creates a temp custom-seed directory containing the given seed.yaml body. */
export function writeManifestDir(yaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-integration-seed-'));
  fs.writeFileSync(path.join(dir, 'seed.yaml'), yaml);
  return dir;
}

export function writeSeedFile(dir: string, relative: string, content: string): void {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * Logger that records every log call so a suite can assert on the seed's
 * structured output (e.g. the final summary) and on the absence of
 * error-level logs. `error` also reaches the console, as in quietLogger.
 */
export interface CapturedLog {
  level: 'info' | 'warn' | 'error' | 'debug';
  args: unknown[];
}

export function capturingLogger(sink: CapturedLog[]): Logger {
  const push = (level: CapturedLog['level']) => {
    return (...args: unknown[]) => {
      sink.push({ level, args });
      if (level === 'error') console.error('[seed error]', ...args);
    };
  };
  const logger = {
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    debug: push('debug'),
    child: () => logger,
  };
  return logger as unknown as Logger;
}

/** Builds the `runCustomSeed` dependency bag shared by every seed-boot suite. */
export function seedDeps(prisma: PrismaClient, customSeedDir: string, logger?: Logger): CustomSeedDependencies {
  return {
    logger: logger ?? quietLogger(),
    prisma,
    systemTenantId: SYSTEM_TENANT_ID,
    customSeedDir,
    storageService: null,
    storageServiceInstanceId: null,
  };
}

/**
 * Writes a manifest (and any accompanying seed files) to a temp directory,
 * runs the custom seed against it, and removes the directory afterwards.
 */
export async function bootManifest(
  prisma: PrismaClient,
  yaml: string,
  files: Record<string, string> = {},
  logger?: Logger,
): Promise<void> {
  const dir = writeManifestDir(yaml);
  for (const [relative, content] of Object.entries(files)) {
    writeSeedFile(dir, relative, content);
  }
  try {
    await runCustomSeed(seedDeps(prisma, dir, logger));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function seedSystemTenant(prisma: PrismaClient): Promise<void> {
  await prisma.tenant.create({ data: { id: SYSTEM_TENANT_ID, name: 'System' } });
}

export const CVC_DATA_MODEL_ID = 'ctestcvcdatamodel00000001';
export const CVC_SPEC_VERSION = '0.7.0';

/**
 * Seeds the core `ConformityScheme` data-model row ingest resolves its
 * schema URL from, pointing at the fixture server so no test fetches a
 * remote schema.
 */
export async function seedCvcDataModel(prisma: PrismaClient, fixtures: FixtureServer): Promise<void> {
  fixtures.set('/cvc/schema.json', { body: JSON.stringify({ type: 'object' }) });
  fixtures.set('/cvc/context.jsonld', {
    body: JSON.stringify({ '@context': { '@vocab': 'https://test.example/vocab#', id: '@id', type: '@type' } }),
    contentType: 'application/ld+json',
  });
  await prisma.dataModel.create({
    data: {
      id: CVC_DATA_MODEL_ID,
      tenantId: SYSTEM_TENANT_ID,
      name: `ConformityScheme v${CVC_SPEC_VERSION}`,
      credentialType: 'ConformityScheme',
      version: CVC_SPEC_VERSION,
      isExtension: false,
      schemaUrl: `${fixtures.baseUrl}/cvc/schema.json`,
      contextUrl: `${fixtures.baseUrl}/cvc/context.jsonld`,
      source: RecordSource.CORE_SEED,
    },
  });
}

export interface FixtureCriterion {
  id: string;
  name: string;
  version?: string;
}

export interface FixtureProfile {
  id: string;
  name: string;
  version?: string;
  criteria?: FixtureCriterion[];
}

/** Builds a parseable v0.7.0 conformity scheme JSON-LD document. */
export function schemeDoc(
  fixtures: FixtureServer,
  canonicalId: string,
  options: { name: string; profiles?: FixtureProfile[] },
): Record<string, unknown> {
  return {
    '@context': [`${fixtures.baseUrl}/cvc/context.jsonld`],
    type: ['ConformityScheme'],
    id: canonicalId,
    name: options.name,
    includedProfile: (options.profiles ?? []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      version: profile.version ?? '1.0.0',
      status: 'active',
      criterion: (profile.criteria ?? []).map((criterion) => ({
        type: ['Criterion'],
        id: criterion.id,
        name: criterion.name,
        version: criterion.version ?? '1.0.0',
        status: 'active',
        conformityTopic: 'environment.energy',
      })),
    })),
  };
}

export type NativeCredentialFixture = {
  id?: string;
  tenantId?: string;
  storageUri?: string;
  digestMultibase?: string;
  decryptionKey?: string | null;
  credentialType?: string;
  coreCredentialType?: CoreCredentialType | null;
  coreDataModelVersion?: string | null;
  detailsStatus?: CredentialDetailsStatus;
  detailsError?: CredentialDetailsError | null;
  details?: {
    name?: string | null;
    issuerName?: string | null;
    issuerDid?: string | null;
    subjectName?: string | null;
    subjectId?: string | null;
    validFrom?: Date | null;
    validUntil?: Date | null;
  };
};

/**
 * Inserts a native credential the way the write paths do (ADR-053 decision
 * 1): its LibraryRecord parent and its Credential child, sharing one id, in
 * one transaction. Suites that need a credential row use this rather than
 * creating a bare child, which the schema refuses.
 */
export async function insertNativeCredential(
  prisma: PrismaClient,
  fixture: NativeCredentialFixture = {},
): Promise<{ id: string }> {
  const tenantId = fixture.tenantId ?? SYSTEM_TENANT_ID;
  return prisma.$transaction(async (tx) => {
    const record = await tx.libraryRecord.create({
      data: {
        ...(fixture.id !== undefined ? { id: fixture.id } : {}),
        tenantId,
        origin: LibraryRecordOrigin.NATIVE,
        credentialType: fixture.credentialType ?? 'DigitalProductPassport',
        coreCredentialType: fixture.coreCredentialType ?? null,
        coreDataModelVersion: fixture.coreDataModelVersion ?? null,
        ...(fixture.detailsStatus !== undefined ? { detailsStatus: fixture.detailsStatus } : {}),
        detailsError: fixture.detailsError ?? null,
        ...(fixture.details ?? {}),
      },
    });
    await tx.credential.create({
      data: {
        id: record.id,
        tenantId,
        storageUri: fixture.storageUri ?? `https://storage.test/${record.id}`,
        digestMultibase: fixture.digestMultibase ?? `z${record.id}`,
        decryptionKey: fixture.decryptionKey ?? null,
      },
    });
    return { id: record.id };
  });
}
