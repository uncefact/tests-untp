process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.TENANT_MODE = 'open';

const mockCapturedLogLines: string[] = [];

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}));

jest.mock('@uncefact/untp-ri-services/logging', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services/logging');
  return {
    ...actual,
    createLogger: (config: Record<string, unknown> = {}) =>
      actual.createLogger({
        ...config,
        level: 'debug',
        destination: { write: (line: string) => mockCapturedLogLines.push(line) },
      }),
  };
});

jest.mock('@/lib/api/with-tenant-auth', () => jest.requireActual('@/lib/api/with-tenant-auth'));
jest.mock('@/auth', () => ({ auth: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/api/service-account-user', () => ({
  resolveServiceAccountUser: jest.fn().mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' }),
}));

const mockGetLibraryRecordById = jest.fn();
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  getLibraryRecordById: (...args: unknown[]) => mockGetLibraryRecordById(...args),
}));

import { createCipheriv, randomBytes } from 'node:crypto';
import { EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import {
  CheckResult,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  ExternalContentKind,
  LibraryRecordOrigin,
  type CheckRun,
  type ExternalCredential,
  type LibraryRecord,
} from '@/lib/prisma/generated';
import { protectDecryptionKey } from '@/lib/credentials/decryption-key-protection';
import { getEncryptionService } from '@/lib/encryption/encryption';
import type { LibraryRecordDetailView } from '@/lib/library/library-record-view';
import { apiLogger } from '@/lib/api/logger';
import { GET } from './route';

const SENTINEL_KEY = 'deadbeefcafe0042'.repeat(4);
const WRONG_DATA_ENCRYPTION_KEY = 'b'.repeat(64);
const WRAPPING_KEY = process.env.DATA_ENCRYPTION_KEY as string;

function view(storedKey: string | null): LibraryRecordDetailView {
  const now = new Date('2026-09-05T00:00:00.000Z');
  const record: LibraryRecord = {
    id: 'record-1',
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.EXTERNAL,
    name: 'Credential',
    issuerName: 'Issuer',
    issuerDid: 'did:web:issuer.example',
    subjectName: 'Subject',
    subjectId: 'https://issuer.example/subject',
    validFrom: now,
    validUntil: null,
    credentialType: 'DigitalConformityCredential',
    coreCredentialType: CoreCredentialType.DCC,
    coreDataModelVersion: '0.6.0',
    detailsStatus: CredentialDetailsStatus.EXTRACTED,
    detailsError: null,
    createdAt: now,
    updatedAt: now,
  };
  const external: ExternalCredential = {
    id: record.id,
    tenantId: record.tenantId,
    origin: LibraryRecordOrigin.EXTERNAL,
    sourceUrl: 'https://supplier.example/credential',
    sourceDigest: 'zSourceDigest',
    contentDigest: null,
    duplicateOfRecordId: null,
    encrypted: false,
    contentKind: ExternalContentKind.CREDENTIAL,
    storageUri: 'https://storage.example/credential',
    storageDigestMultibase: 'zStorageDigest',
    storageServiceInstanceId: 'storage-1',
    storageExternalId: 'external-1',
    storageBucket: 'private',
    decryptionKey: storedKey,
    displayName: 'Credential',
    declaredCredentialType: CoreCredentialType.DCC,
    dateReceived: null,
    notes: null,
    annotationVersion: 1,
    decryptionKeyUnused: false,
    createdAt: now,
    updatedAt: now,
  };
  const checkRun: CheckRun = {
    id: 'run-1',
    recordId: record.id,
    tenantId: record.tenantId,
    generation: 1,
    state: CheckRunState.COMPLETE,
    retrieval: CheckResult.PASS,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.PASS,
    proof: CheckResult.PASS,
    status: CheckResult.PASS,
    temporal: CheckResult.PASS,
    schemaConformance: CheckResult.PASS,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    requestedAt: now,
    completedAt: now,
    lastEnqueuedAt: null,
    sourceChanged: null,
    lastSourceCheckAt: null,
  };
  return { origin: LibraryRecordOrigin.EXTERNAL, record, external, checkRun };
}

function request(correlationId?: string): Request {
  const headers = new Headers({ 'x-auth-sub': 'service-sub' });
  if (correlationId !== undefined) headers.set('x-correlation-id', correlationId);
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/library/record-1',
    headers,
  } as unknown as Request;
}

function degradationLines(): Record<string, unknown>[] {
  return mockCapturedLogLines
    .map((captured) => JSON.parse(captured) as Record<string, unknown>)
    .filter((entry) => entry.msg === 'Library record read degraded');
}

function wrongKeyEnvelope(): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(WRONG_DATA_ENCRYPTION_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(SENTINEL_KEY, 'utf8'), cipher.final()]);
  return JSON.stringify({
    cipherText: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    type: 'aes-256-gcm',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapturedLogLines.length = 0;
  mockGetLibraryRecordById.mockResolvedValue(view(protectDecryptionKey(SENTINEL_KEY)));
});

describe('GET /api/v1/library/:id never logs the revealed key', () => {
  it('uses the real wrapper, projection and reveal on success without logging the key', async () => {
    const response = (await GET(request(), { params: Promise.resolve({ id: 'record-1' }) })) as unknown as {
      status: number;
      json: () => Promise<unknown>;
    };
    const body = (await response.json()) as { decryptionKey: string };

    expect(response.status).toBe(200);
    expect(body.decryptionKey).toBe(SENTINEL_KEY);
    expect(mockCapturedLogLines.length).toBeGreaterThan(0);
    expect(mockCapturedLogLines.join('')).not.toContain(SENTINEL_KEY);
  });

  it('returns a warning and does not log the stored envelope, wrapping key or revealed key on a real decrypt failure', async () => {
    const stored = wrongKeyEnvelope();
    mockGetLibraryRecordById.mockResolvedValue(view(stored));

    const response = (await GET(request(), { params: Promise.resolve({ id: 'record-1' }) })) as unknown as {
      status: number;
      json: () => Promise<unknown>;
    };

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      hasKey: boolean;
      decryptionKey: string | null;
      warnings: Array<{ code: string }>;
    };
    expect(body).toMatchObject({
      hasKey: true,
      decryptionKey: null,
      warnings: [{ code: 'DECRYPTION_KEY_UNAVAILABLE' }],
    });
    expect(mockCapturedLogLines.length).toBeGreaterThan(0);
    const captured = mockCapturedLogLines.join('');
    expect(captured).not.toContain(SENTINEL_KEY);
    expect(captured).not.toContain(stored);
    expect(captured).not.toContain(JSON.parse(stored).cipherText);
    expect(captured).not.toContain(WRAPPING_KEY);
    expect(captured).not.toContain(WRONG_DATA_ENCRYPTION_KEY);
  });

  it('logs one safe degradation event against the record and nothing else that failure held', async () => {
    const stored = wrongKeyEnvelope();
    mockGetLibraryRecordById.mockResolvedValue(view(stored));

    await GET(request(), { params: Promise.resolve({ id: 'record-1' }) });

    const lines = degradationLines();
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatchObject({
      recordId: 'record-1',
      code: 'DECRYPTION_KEY_UNAVAILABLE',
      readStage: 'detail',
      reason: 'unwrap-failed',
    });
    expect(mockCapturedLogLines.some((captured) => captured.includes('Failed to decrypt stored credential'))).toBe(
      false,
    );
    const serialised = JSON.stringify(line);
    expect(serialised).not.toContain(SENTINEL_KEY);
    expect(serialised).not.toContain(JSON.parse(stored).cipherText);
    expect(serialised).not.toContain(WRAPPING_KEY);
    expect(serialised).not.toContain(WRONG_DATA_ENCRYPTION_KEY);
  });

  it.each([
    ['unwrap-failed', () => wrongKeyEnvelope(), 'credentials.decryption-key-unwrap'],
    [
      'malformed-envelope',
      () => JSON.stringify({ cipherText: 'dHJ1bmNhdGVk', type: 'aes-256-gcm' }),
      'credentials.decryption-key-envelope-malformed',
    ],
  ])(
    'names %s and carries its cause, with none of the secrets that failure held',
    async (reason, storedKey, errorCode) => {
      // The two causes need opposite repairs, and the caller's 200 says nothing
      // about either, so the event's own reason and message are the operator's
      // only account. A constant detail in their place makes them identical.
      const stored = storedKey();
      mockGetLibraryRecordById.mockResolvedValue(view(stored));

      await GET(request(), { params: Promise.resolve({ id: 'record-1' }) });

      const lines = degradationLines();
      expect(lines).toHaveLength(1);
      const error = lines[0].error as { name?: string; message?: string };
      // `error.name` is a class name, which a production build minifies, so
      // `errorCode` is what an alert can be keyed on. Every classified reason
      // carries one.
      expect(lines[0]).toMatchObject({ recordId: 'record-1', reason, errorCode });
      expect(error.message).toEqual(expect.any(String));
      expect(error.message).not.toBe('');

      const serialised = JSON.stringify(lines[0]);
      expect(serialised).not.toContain(SENTINEL_KEY);
      expect(serialised).not.toContain(stored);
      expect(serialised).not.toContain(WRAPPING_KEY);
      expect(serialised).not.toContain(WRONG_DATA_ENCRYPTION_KEY);
    },
  );

  it('names key-configuration, not a damaged row, when the deployment key cannot be resolved', async () => {
    // One row's envelope and a whole deployment's missing key are the same 200
    // to the caller and need opposite repairs, so the distinction lives here.
    const stored = protectDecryptionKey(SENTINEL_KEY);
    jest.resetModules();
    delete process.env.DATA_ENCRYPTION_KEY;
    try {
      // The repository mock factory closes over this test file's own jest.fn,
      // so the fresh module registry still reads the row set here.
      mockGetLibraryRecordById.mockResolvedValue(view(stored));
      const { GET: freshGet } = await import('./route');

      const response = (await freshGet(request(), { params: Promise.resolve({ id: 'record-1' }) })) as unknown as {
        status: number;
        json: () => Promise<{ hasKey: boolean; decryptionKey: string | null }>;
      };

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ hasKey: true, decryptionKey: null });

      const lines = degradationLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        recordId: 'record-1',
        reason: 'key-configuration',
        errorCode: 'credentials.encryption-service-unavailable',
      });
      expect((lines[0].error as { message: string }).message).toContain('DATA_ENCRYPTION_KEY');
      expect(JSON.stringify(lines[0])).not.toContain(SENTINEL_KEY);
      expect(JSON.stringify(lines[0])).not.toContain(stored);
    } finally {
      process.env.DATA_ENCRYPTION_KEY = WRAPPING_KEY;
      jest.resetModules();
    }
  });

  it('stamps the served correlation id on the degradation event', async () => {
    // The caller's message tells them to quote the x-correlation-id header, so
    // the id the operator can search for must be the one the request context
    // established. Nothing in the event sets it; the logger's mixin does.
    const correlationId = '3f4a6d1e-9c2b-4f0e-8a71-5b6c7d8e9f01';
    mockGetLibraryRecordById.mockResolvedValue(view(wrongKeyEnvelope()));

    await GET(request(correlationId), { params: Promise.resolve({ id: 'record-1' }) });

    const lines = degradationLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].correlationId).toBe(correlationId);
  });

  it('proves the capture would catch a sentinel written through the logger the decrypt path uses', () => {
    apiLogger.info({ leakCheck: SENTINEL_KEY }, 'deliberate sentinel write');

    // The encryption service builds its logger the same way this probe does, so
    // a sentinel found here would be found in anything that path logs.
    createLogger().child({ module: 'encryption' }).error({ leakCheck: SENTINEL_KEY }, 'deliberate sentinel write');

    const service = getEncryptionService();
    service.decrypt(service.encrypt(SENTINEL_KEY, EncryptionAlgorithm.AES_256_GCM));

    const captured = mockCapturedLogLines.join('');
    expect(captured.split(SENTINEL_KEY).length - 1).toBe(2);
    expect(captured).toContain('Encrypting data');
    expect(captured).toContain('Decrypting data');
  });
});
