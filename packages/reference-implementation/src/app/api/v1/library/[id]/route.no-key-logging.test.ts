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
  };
  return { origin: LibraryRecordOrigin.EXTERNAL, record, external, checkRun };
}

function request(): Request {
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/library/record-1',
    headers: new Headers({ 'x-auth-sub': 'service-sub' }),
  } as unknown as Request;
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

  it('does not log the stored envelope, the wrapping key or the revealed key on a real decrypt failure', async () => {
    const stored = wrongKeyEnvelope();
    mockGetLibraryRecordById.mockResolvedValue(view(stored));

    const response = (await GET(request(), { params: Promise.resolve({ id: 'record-1' }) })) as unknown as {
      status: number;
      json: () => Promise<unknown>;
    };

    expect(response.status).toBe(500);
    expect(mockCapturedLogLines.length).toBeGreaterThan(0);
    const captured = mockCapturedLogLines.join('');
    expect(captured).not.toContain(SENTINEL_KEY);
    expect(captured).not.toContain(stored);
    expect(captured).not.toContain(JSON.parse(stored).cipherText);
    expect(captured).not.toContain(WRAPPING_KEY);
    expect(captured).not.toContain(WRONG_DATA_ENCRYPTION_KEY);
  });

  it('logs the 500 against the record with the error and nothing else that failure held', async () => {
    const stored = wrongKeyEnvelope();
    mockGetLibraryRecordById.mockResolvedValue(view(stored));

    await GET(request(), { params: Promise.resolve({ id: 'record-1' }) });

    const line = mockCapturedLogLines
      .map((captured) => JSON.parse(captured) as Record<string, unknown>)
      .find((entry) => entry.msg === 'The stored decryption key could not be revealed');

    expect(line).toBeDefined();
    expect(line).toMatchObject({ recordId: 'record-1', err: { type: 'DecryptionKeyRevealError' } });
    const serialised = JSON.stringify(line);
    expect(serialised).not.toContain(SENTINEL_KEY);
    expect(serialised).not.toContain(JSON.parse(stored).cipherText);
    expect(serialised).not.toContain(WRAPPING_KEY);
    expect(serialised).not.toContain(WRONG_DATA_ENCRYPTION_KEY);
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
