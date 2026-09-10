// The production decoder must parse the real compact JWT in this integration
// suite. The unit Jest mock is not evidence for that dependency boundary.
jest.unmock('jose');

import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { insertNativeCredential, seedSystemTenant } from './fixtures';
import {
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
} from '../../src/lib/prisma/generated/index.js';
import { protectDecryptionKey } from '../../src/lib/credentials/decryption-key-protection';

/**
 * Integration coverage for the credential-details backfill (#953), against
 * real Postgres through the rig.
 *
 * The unit suite runs the backfill against a hand-written client whose
 * `findMany` reimplements the production query. This suite is the layer
 * that can fail if the PENDING filter, the version column, or the
 * idempotent second run do not hold against a real table.
 */

const DEPLOYMENT_KEY = 'a'.repeat(64);
const CREDENTIAL_KEY = 'b'.repeat(64);
const originalDataEncryptionKey = process.env.DATA_ENCRYPTION_KEY;
const originalServiceEncryptionKey = process.env.SERVICE_ENCRYPTION_KEY;

process.env.DATA_ENCRYPTION_KEY = DEPLOYMENT_KEY;
delete process.env.SERVICE_ENCRYPTION_KEY;

const client = createRigClient();
const observer = createRigClient();
let fixtures!: FixtureServer;

const quietLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
};

const DEFAULT_CREDENTIAL = {
  name: 'Wool Passport',
  issuerName: 'Example Issuer',
  issuerDid: 'did:web:issuer.example',
  subjectName: 'Merino batch',
  subjectId: 'https://example.com/product/1',
};

const BACKFILL_IDS = ['cred-backfill-bad', 'cred-backfill-encrypted', 'cred-backfill-plain'] as const;

beforeEach(async () => {
  fixtures = await startFixtureServer();
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
});

afterEach(async () => {
  await fixtures.close();
});

afterAll(async () => {
  await client.$disconnect();
  await observer.$disconnect();
  if (originalDataEncryptionKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = originalDataEncryptionKey;
  if (originalServiceEncryptionKey === undefined) delete process.env.SERVICE_ENCRYPTION_KEY;
  else process.env.SERVICE_ENCRYPTION_KEY = originalServiceEncryptionKey;
});

function compactJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'vc+jwt' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function credentialPayload(fields: typeof DEFAULT_CREDENTIAL): Record<string, unknown> {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    name: fields.name,
    issuer: { id: fields.issuerDid, name: fields.issuerName },
    credentialSubject: {
      product: { id: fields.subjectId, name: fields.subjectName },
    },
    validFrom: '2024-01-15T00:00:00.000Z',
    validUntil: '2025-01-15T00:00:00.000Z',
  };
}

function envelopedCredential(fields: typeof DEFAULT_CREDENTIAL = DEFAULT_CREDENTIAL): Record<string, unknown> {
  const payload = credentialPayload(fields);
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: `data:application/vc+jwt,${compactJwt(payload)}`,
    type: 'EnvelopedVerifiableCredential',
  };
}

function credentialArtifact(fields: typeof DEFAULT_CREDENTIAL = DEFAULT_CREDENTIAL): string {
  return JSON.stringify(envelopedCredential(fields));
}

function encryptedCredentialArtifact(fields: typeof DEFAULT_CREDENTIAL = DEFAULT_CREDENTIAL): string {
  const adapter = new AesGcmEncryptionAdapter(CREDENTIAL_KEY, quietLogger as never);
  return JSON.stringify(adapter.encrypt(credentialArtifact(fields), EncryptionAlgorithm.AES_256_GCM));
}

async function readBackfillRows() {
  return observer.libraryRecord.findMany({
    where: { id: { in: [...BACKFILL_IDS] } },
    orderBy: { id: 'asc' },
  });
}

describe('credential-details backfill against Postgres', () => {
  it('fills in only the core kind of an extracted record that has none, and leaves a record with a known kind alone', async () => {
    fixtures.set('/backfill/core-kind', { body: credentialArtifact() });
    await insertNativeCredential(client, {
      id: 'cred-nokind',
      credentialType: 'DigitalLivestockPassport',
      coreCredentialType: null,
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
      details: { name: 'Kept' },
      storageUri: `${fixtures.baseUrl}/backfill/core-kind`,
    });
    await insertNativeCredential(client, {
      id: 'cred-known',
      coreCredentialType: CoreCredentialType.DPP,
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
    });
    const { backfillCredentialDetails } = await import('../../src/lib/credentials/backfill-credential-details');
    const result = await backfillCredentialDetails(client);

    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ scanned: 1, updated: 0, coreKindsResolved: 1, failed: 0 });
    const filled = await client.libraryRecord.findUniqueOrThrow({ where: { id: 'cred-nokind' } });
    expect(filled.coreCredentialType).toBe(CoreCredentialType.DPP);
    expect(filled.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(filled.name).toBe('Kept');
  });

  it('leaves three pre-capture rows unchanged in dry-run, persists each apply outcome, and converges on a second apply', async () => {
    const encryptedFields = {
      name: 'Encrypted Wool Passport',
      issuerName: 'Encrypted Example Issuer',
      issuerDid: 'did:web:encrypted.issuer.example',
      subjectName: 'Encrypted Merino batch',
      subjectId: 'https://example.com/product/encrypted',
    };
    const plaintextFields = {
      name: 'Plain Wool Passport',
      issuerName: 'Plain Example Issuer',
      issuerDid: 'did:web:plain.issuer.example',
      subjectName: 'Plain Merino batch',
      subjectId: 'https://example.com/product/plain',
    };
    fixtures.set('/backfill/unreadable', { body: '{not-json' });
    fixtures.set('/backfill/encrypted', { body: encryptedCredentialArtifact(encryptedFields) });
    fixtures.set('/backfill/plain', { body: credentialArtifact(plaintextFields) });

    await insertNativeCredential(client, {
      id: 'cred-backfill-bad',
      storageUri: `${fixtures.baseUrl}/backfill/unreadable`,
      digestMultibase: 'zQmBackfillBad',
      coreCredentialType: CoreCredentialType.DPP,
      detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
    });
    await insertNativeCredential(client, {
      id: 'cred-backfill-encrypted',
      storageUri: `${fixtures.baseUrl}/backfill/encrypted`,
      digestMultibase: 'zQmBackfillEncrypted',
      coreCredentialType: CoreCredentialType.DPP,
      detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
      decryptionKey: protectDecryptionKey(CREDENTIAL_KEY),
    });
    await insertNativeCredential(client, {
      id: 'cred-backfill-plain',
      storageUri: `${fixtures.baseUrl}/backfill/plain`,
      digestMultibase: 'zQmBackfillPlain',
      coreCredentialType: CoreCredentialType.DPP,
      detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
    });

    const { backfillCredentialDetails } = await import('../../src/lib/credentials/backfill-credential-details');
    const beforeDryRun = await readBackfillRows();

    const dryRun = await backfillCredentialDetails(client, { dryRun: true });

    expect(dryRun).toMatchObject({ dryRun: true, scanned: 3, updated: 2, failed: 1 });
    expect(dryRun.failures).toEqual([
      {
        id: 'cred-backfill-bad',
        errorClass: CredentialDetailsError.UNREADABLE_ENVELOPE,
        message: 'Response from storage URI is not valid JSON',
      },
    ]);
    expect(await readBackfillRows()).toEqual(beforeDryRun);

    const applied = await backfillCredentialDetails(client);

    expect(applied).toMatchObject({ dryRun: false, scanned: 3, updated: 2, failed: 1 });
    expect(applied.failures).toEqual([
      {
        id: 'cred-backfill-bad',
        errorClass: CredentialDetailsError.UNREADABLE_ENVELOPE,
        message: 'Response from storage URI is not valid JSON',
      },
    ]);

    const afterApply = await readBackfillRows();
    expect(afterApply).toEqual([
      expect.objectContaining({
        id: 'cred-backfill-bad',
        detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
        detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
        coreCredentialType: CoreCredentialType.DPP,
      }),
      expect.objectContaining({
        id: 'cred-backfill-encrypted',
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
        detailsError: null,
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.1',
        name: encryptedFields.name,
        issuerName: encryptedFields.issuerName,
        issuerDid: encryptedFields.issuerDid,
        subjectName: encryptedFields.subjectName,
        subjectId: encryptedFields.subjectId,
        validFrom: new Date('2024-01-15T00:00:00.000Z'),
        validUntil: new Date('2025-01-15T00:00:00.000Z'),
      }),
      expect.objectContaining({
        id: 'cred-backfill-plain',
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
        detailsError: null,
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.1',
        name: plaintextFields.name,
        issuerName: plaintextFields.issuerName,
        issuerDid: plaintextFields.issuerDid,
        subjectName: plaintextFields.subjectName,
        subjectId: plaintextFields.subjectId,
        validFrom: new Date('2024-01-15T00:00:00.000Z'),
        validUntil: new Date('2025-01-15T00:00:00.000Z'),
      }),
    ]);

    const secondApply = await backfillCredentialDetails(client);

    expect(secondApply).toEqual({
      dryRun: false,
      scanned: 0,
      updated: 0,
      coreKindsResolved: 0,
      failed: 0,
      failures: [],
    });
    expect(await readBackfillRows()).toEqual(afterApply);
  });
});
