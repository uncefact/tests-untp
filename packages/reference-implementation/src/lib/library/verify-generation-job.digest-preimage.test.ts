/**
 * Pins the preimage the worker digests a credential copy against, using a
 * digest the UNTP storage service itself returned.
 *
 * The vector below was produced by storing one enveloped credential through
 * `UncefactStorageAdapter` against a running storage service, twice: once
 * encrypted into the private bucket and once plain into the public bucket.
 * Both stores returned this same digest, which is the service's statement that
 * it digests the bytes it was handed rather than the bytes it wrote. So a
 * credential copy read back must be re-serialised before it is checked, and
 * digesting the bytes read back would fail every encrypted copy with what
 * reads to the caller as proven corruption.
 *
 * The digest is decoded here rather than checked through the same library the
 * production code uses. A builder and an extractor that agree with each other
 * are not evidence that either agrees with the contract's owner, and the
 * decoder below is the independent half of that pair.
 */

jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));

import { createHash } from 'node:crypto';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CredentialDetailsStatus,
  CoreCredentialType,
  LibraryRecordOrigin,
  type CheckRun,
  type Credential,
  type LibraryRecord,
} from '@/lib/prisma/generated';
import type { LibraryRecordDetailView } from '@/lib/library/library-record-view';
import { verifyGenerationHandler, type VerifyGenerationDependencies } from '@/lib/library/verify-generation-job';
import { noChecksRun } from '@/lib/prisma/repositories/check-run.repository';

const RECORD_ID = 'crec0000000000000000000001';
const RUN_ID = 'crun0000000000000000000003';
const TENANT_ID = 'tenant-1';
const STORAGE_URI = 'https://storage.example/native/credential';

/** The exact credential object handed to the storage service in the round trip. */
const CREDENTIAL = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: 'EnvelopedVerifiableCredential',
  id: 'data:application/vc+jwt,eyJhbGciOiJFUzI1NiJ9.eyJmb28iOiJiYXIifQ.sig',
};

/** The digest the storage service returned for that credential, from both buckets. */
const SERVICE_DIGEST = 'zQmRN1k4vAy4tDune9Fa164K2aBdG6ukeeH2vPZnTeQUWKQ';

const BASE58BTC_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decodes a base58btc body to bytes. Ten lines of arithmetic, no dependency. */
function decodeBase58(encoded: string): Uint8Array {
  const bytes = [0];
  for (const character of encoded) {
    const value = BASE58BTC_ALPHABET.indexOf(character);
    if (value < 0) throw new Error(`not base58btc: ${character}`);
    let carry = value;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const character of encoded) {
    if (character !== BASE58BTC_ALPHABET[0]) break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/** The raw digest inside the multibase multihash, with its algorithm and length asserted. */
function serviceDigestBytes(): Uint8Array {
  expect(SERVICE_DIGEST.startsWith('z')).toBe(true);
  const multihash = decodeBase58(SERVICE_DIGEST.slice(1));
  // 0x12 is sha2-256 and 0x20 is its 32-byte length, in the multihash header.
  expect([multihash[0], multihash[1], multihash.length]).toEqual([0x12, 0x20, 34]);
  return multihash.slice(2);
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The production comparison, done here without the library the worker uses. */
function verifyAgainstService(expected: string, data: Uint8Array): Promise<boolean> {
  expect(expected).toBe(SERVICE_DIGEST);
  return Promise.resolve(sha256(data) === Buffer.from(serviceDigestBytes()).toString('hex'));
}

function run(): CheckRun {
  return {
    id: RUN_ID,
    recordId: RECORD_ID,
    tenantId: TENANT_ID,
    generation: 2,
    state: CheckRunState.PENDING,
    ...noChecksRun(),
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    sourceChanged: null,
    lastSourceCheckAt: null,
    requestedAt: new Date('2026-09-07T00:00:00.000Z'),
    completedAt: null,
    lastEnqueuedAt: new Date('2026-09-07T00:00:00.000Z'),
  };
}

function record(): LibraryRecordDetailView {
  const now = new Date('2026-09-07T00:00:00.000Z');
  const parent: LibraryRecord = {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.NATIVE,
    name: 'Native credential',
    issuerName: 'Issuer',
    issuerDid: 'did:web:issuer.example',
    subjectName: 'Subject',
    subjectId: 'https://issuer.example/subject',
    validFrom: now,
    validUntil: null,
    credentialType: 'DigitalProductPassport',
    coreCredentialType: CoreCredentialType.DPP,
    coreDataModelVersion: '0.6.0',
    detailsStatus: CredentialDetailsStatus.EXTRACTED,
    detailsError: null,
    createdAt: now,
    updatedAt: now,
  };
  const credential: Credential = {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.NATIVE,
    storageUri: STORAGE_URI,
    digestMultibase: SERVICE_DIGEST,
    decryptionKey: null,
    isPublished: false,
    organisationId: null,
    facilityId: null,
    productId: null,
    createdAt: now,
    updatedAt: now,
  };
  return { origin: LibraryRecordOrigin.NATIVE, record: parent, credential, checkRun: run() };
}

function dependencies(storedText: string): VerifyGenerationDependencies {
  return {
    findRun: jest.fn().mockResolvedValue(run()),
    getRecord: jest.fn().mockResolvedValue(record()),
    fetchStoredCopy: jest.fn().mockResolvedValue(new TextEncoder().encode(storedText)),
    revealStoredKey: jest.fn(),
    verifyDigest: jest.fn(verifyAgainstService),
    resolveVerifier: jest.fn().mockResolvedValue({ verify: jest.fn().mockResolvedValue({ verified: true }) }),
    settleComplete: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    settleFailed: jest.fn().mockResolvedValue({ outcome: 'applied' }),
  };
}

const JOB = { tenantId: TENANT_ID, recordId: RECORD_ID, generation: 2, checkRunId: RUN_ID };
const CONTEXT = { jobId: 'job-1', attempt: 1, isFinalAttempt: true, signal: new AbortController().signal };

describe('the credential copy digest preimage', () => {
  it('is the compact JSON.stringify of the credential, as the storage service reported it', () => {
    // The vector itself, independent of any worker code. Fails if the digest
    // is transcribed wrongly, or if it turns out to cover the pretty-printed
    // form, which is what a maintainer would reach for next.
    expect(sha256(new TextEncoder().encode(JSON.stringify(CREDENTIAL)))).toBe(
      Buffer.from(serviceDigestBytes()).toString('hex'),
    );
    expect(sha256(new TextEncoder().encode(JSON.stringify(CREDENTIAL, null, 2)))).not.toBe(
      Buffer.from(serviceDigestBytes()).toString('hex'),
    );
  });

  it('is reproduced by the worker from a copy whose stored bytes are formatted differently', async () => {
    // The bytes read back are pretty-printed, so they cannot match the
    // service's digest as they stand. Fails if the worker digests the bytes
    // it read instead of re-serialising the credential it parsed, which is
    // the change that would settle every encrypted copy as corrupt.
    const deps = dependencies(JSON.stringify(CREDENTIAL, null, 2));

    await verifyGenerationHandler(deps)(JOB, CONTEXT);

    const [expected, data] = (deps.verifyDigest as jest.Mock).mock.calls[0] as [string, Uint8Array];
    expect(expected).toBe(SERVICE_DIGEST);
    expect(Buffer.from(data).toString('utf8')).toBe(JSON.stringify(CREDENTIAL));
    expect(deps.settleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ checks: expect.objectContaining({ digest: CheckResult.PASS }) }),
    );
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('reports a copy whose credential really did change as a failed integrity check', async () => {
    // The sibling, so the case above cannot be satisfied by a comparison that
    // passes whatever it is handed.
    const deps = dependencies(JSON.stringify({ ...CREDENTIAL, id: 'data:application/vc+jwt,tampered' }));

    await verifyGenerationHandler(deps)(JOB, CONTEXT);

    expect(deps.settleComplete).not.toHaveBeenCalled();
    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: expect.objectContaining({ retrieval: CheckResult.PASS, digest: CheckResult.FAIL }),
        failure: expect.objectContaining({
          code: CheckRunFailureCode.STORED_COPY_CORRUPT,
          retryable: false,
        }),
      }),
    );
  });
});
