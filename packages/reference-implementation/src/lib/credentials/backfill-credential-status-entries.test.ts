jest.mock('@/lib/api/logger');

const mockCreateCredentialStatusEntries = jest.fn();
jest.mock('../prisma/repositories/credential-status-entry.repository', () => ({
  createCredentialStatusEntries: (...args: unknown[]) => mockCreateCredentialStatusEntries(...args),
}));

const mockUpdateCredentialStatusCapture = jest.fn();
jest.mock('../prisma/repositories/credential.repository', () => ({
  updateCredentialStatusCapture: (...args: unknown[]) => mockUpdateCredentialStatusCapture(...args),
}));

import {
  backfillCredentialStatusEntries,
  classifyCredentialStatusBackfillFailure,
  CredentialStatusBackfillRowError,
  formatCredentialStatusCapture,
} from './backfill-credential-status-entries';

import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { CredentialStatusCapture } from '../prisma/generated';
import { credentialDigestPreimage } from '../library/verify-generation-job';
import { decodeJwt } from 'jose';
import { createHash } from 'node:crypto';

function compactJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES256' })}.${encode(payload)}.sig`;
}

const BODY = new TextEncoder().encode(
  JSON.stringify({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${compactJwt({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      issuer: { id: 'did:web:issuer.example' },
      credentialSubject: { id: 'https://example.com/subject' },
      credentialStatus: {
        id: 'https://status.example/list/1#3',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListCredential: 'https://status.example/list/1',
        statusListIndex: '3',
        statusSize: 1,
      },
    })}`,
  }),
);

async function bodyDigest(): Promise<string> {
  const parsed = JSON.parse(Buffer.from(BODY).toString('utf8')) as object;
  return (
    await MultibaseDigest.fromData(credentialDigestPreimage(parsed), { algorithm: 'sha2-256', base: 'base58btc' })
  ).toString();
}

function client(row: Record<string, unknown>, failedRows: Array<{ statusCaptureError: string | null }> = []) {
  return {
    libraryRecord: { findMany: jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]) },
    credential: { findMany: jest.fn().mockResolvedValue(failedRows) },
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
  };
}

function pendingRow(digest: string) {
  return {
    id: 'cred-backfill-unit',
    tenantId: 'tenant-backfill-unit',
    credential: {
      storageUri: 'https://storage.test/cred-backfill-unit',
      digestMultibase: digest,
      decryptionKey: null,
      statusCapture: CredentialStatusCapture.PENDING,
      statusCaptureError: null,
    },
  };
}

describe('credential status backfill failure classification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (decodeJwt as jest.Mock).mockImplementation((encoded: string) => {
      const [, payload] = encoded.split('.');
      if (!payload) throw new Error('Invalid JWT');
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    });
    mockCreateCredentialStatusEntries.mockResolvedValue({ outcome: 'created', count: 0 });
    mockUpdateCredentialStatusCapture.mockResolvedValue('updated');
  });

  it('uses the compact credential JSON preimage pinned by the storage digest vector', () => {
    const credential = JSON.parse(
      JSON.stringify({
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc+jwt,eyJhbGciOiJFUzI1NiJ9.eyJmb28iOiJiYXIifQ.sig',
      }),
    ) as object;
    const digestHex = createHash('sha256').update(credentialDigestPreimage(credential)).digest('hex');

    expect(digestHex).toBe('2cec6cb30cb7205688f505de7c5d3843d8cbb2084b6e04348800117855cea307');
  });

  it('preserves a row-specific decryption failure instead of collapsing it into storage failure', () => {
    expect(
      classifyCredentialStatusBackfillFailure(
        new CredentialStatusBackfillRowError('DECRYPT_FAILED', 'The stored copy could not be decrypted'),
      ),
    ).toBe('DECRYPT_FAILED');
  });

  it('reports unexpected errors as storage failures so a batch cannot silently skip a row', () => {
    expect(classifyCredentialStatusBackfillFailure(new Error('object store unavailable'))).toBe('STORAGE_UNAVAILABLE');
  });

  it('persists duplicate-purpose failures as AMBIGUOUS_PURPOSE rather than WRITE_RACE', async () => {
    const digest = await bodyDigest();
    mockCreateCredentialStatusEntries.mockResolvedValue({ outcome: 'duplicate_purpose', purpose: 'revocation' });
    const fake = client(pendingRow(digest));

    const result = await backfillCredentialStatusEntries(fake as never, { fetchStoredCopy: async () => BODY });

    expect(result.failures[0]).toMatchObject({ errorClass: 'AMBIGUOUS_PURPOSE' });
    expect(mockUpdateCredentialStatusCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statusCapture: CredentialStatusCapture.FAILED,
        statusCaptureError: 'AMBIGUOUS_PURPOSE',
      }),
    );
  });

  it('reports captured coordinates in dry-run output data', async () => {
    const digest = await bodyDigest();
    const fake = client(pendingRow(digest));

    const result = await backfillCredentialStatusEntries(fake as never, {
      dryRun: true,
      fetchStoredCopy: async () => BODY,
    });

    expect(formatCredentialStatusCapture(result.capturedRows[0], true)).toContain(
      'Dry run would capture cred-backfill-unit: purposes=revocation; statusListCredential=https://status.example/list/1 statusListIndex=3',
    );
  });

  it('classifies an unexpected capture write error as STORAGE_UNAVAILABLE and logs its cause', async () => {
    const digest = await bodyDigest();
    const cause = new Error('database unavailable');
    mockCreateCredentialStatusEntries.mockRejectedValue(cause);
    const fake = client(pendingRow(digest));

    const result = await backfillCredentialStatusEntries(fake as never, { fetchStoredCopy: async () => BODY });
    const warn = (jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>).warn;

    expect(result.failures[0]).toMatchObject({ errorClass: 'STORAGE_UNAVAILABLE' });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: cause, credentialId: 'cred-backfill-unit', tenantId: 'tenant-backfill-unit' }),
      expect.stringContaining('--retry-failed'),
    );
  });

  it('reports WRITE_RACE only when the capture state update does not update a row', async () => {
    const digest = await bodyDigest();
    mockUpdateCredentialStatusCapture.mockResolvedValue('status_conflict');
    const fake = client(pendingRow(digest));

    const result = await backfillCredentialStatusEntries(fake as never, { fetchStoredCopy: async () => BODY });

    expect(result.failures[0]).toMatchObject({ errorClass: 'WRITE_RACE' });
    expect(mockUpdateCredentialStatusCapture).toHaveBeenCalled();
  });
});
