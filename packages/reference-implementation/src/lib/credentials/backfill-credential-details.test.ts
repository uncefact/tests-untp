export {};

jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const mockGetBridge = jest.fn();
jest.mock('@uncefact/untp-ri-services/data-model-bridges', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services/data-model-bridges');
  return {
    ...actual,
    getBridge: (...args: unknown[]) => mockGetBridge(...args),
  };
});

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);

import { decodeJwt } from 'jose';
import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import { CredentialDetailsError, CredentialDetailsStatus } from '@/lib/prisma/generated';
import { backfillCredentialDetails } from './backfill-credential-details';
import { protectDecryptionKey } from './decryption-key-protection';

const DPP_061_CONTEXT = 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/';
const DPP_060_CONTEXT = 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/';

type StoredRow = {
  id: string;
  storageUri: string;
  decryptionKey: string | null;
  credentialType: string;
  coreDataModelVersion: string | null;
  detailsStatus: string;
  detailsError?: string | null;
  name?: string | null;
  issuerName?: string | null;
  issuerDid?: string | null;
  subjectName?: string | null;
  subjectId?: string | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
};

function compactJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function decodeCompactJwt(jwt: string): Record<string, unknown> {
  const { 1: payload, length } = jwt.split('.');
  if (length !== 3 || !payload) {
    throw new Error('Invalid JWT');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function enveloped(payload: Record<string, unknown>) {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: `data:application/vc+jwt,${compactJwt(payload)}`,
    type: 'EnvelopedVerifiableCredential',
  };
}

function dppPayload(overrides: Record<string, unknown> = {}) {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', DPP_061_CONTEXT],
    name: 'Wool Passport',
    issuer: { id: 'did:web:issuer.example', name: 'Example Issuer' },
    credentialSubject: {
      product: { id: 'https://example.com/product/1', name: 'Merino batch' },
    },
    validFrom: '2024-01-15T00:00:00.000Z',
    validUntil: '2025-01-15T00:00:00.000Z',
    ...overrides,
  };
}

function pendingRow(overrides: Partial<StoredRow> = {}): StoredRow {
  const id = overrides.id ?? 'cred-1';
  return {
    id,
    storageUri: `https://storage.test/${id}`,
    decryptionKey: null,
    credentialType: 'DigitalProductPassport',
    coreDataModelVersion: null,
    detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
    detailsError: null,
    ...overrides,
  };
}

function createFakeClient(rows: StoredRow[]) {
  return {
    credential: {
      findMany: jest.fn(
        async (args: {
          where: { detailsStatus: string; id?: { gt: string } };
          take: number;
        }): Promise<
          Array<{
            id: string;
            storageUri: string;
            decryptionKey: string | null;
            credentialType: string;
            coreDataModelVersion: string | null;
          }>
        > =>
          rows
            .filter((row) => row.detailsStatus === args.where.detailsStatus)
            .filter((row) => (args.where.id ? row.id > args.where.id.gt : true))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, args.take)
            .map((row) => ({
              id: row.id,
              storageUri: row.storageUri,
              decryptionKey: row.decryptionKey,
              credentialType: row.credentialType,
              coreDataModelVersion: row.coreDataModelVersion,
            })),
      ),
      updateMany: jest.fn(
        async (args: { where: { id: string; detailsStatus: string }; data: Record<string, unknown> }) => {
          const row = rows.find(
            (candidate) => candidate.id === args.where.id && candidate.detailsStatus === args.where.detailsStatus,
          );
          if (!row) {
            return { count: 0 };
          }
          Object.assign(row, args.data);
          return { count: 1 };
        },
      ),
    },
  };
}

function fetchJson(body: unknown) {
  return jest.fn(async () => JSON.stringify(body));
}

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
};
mockLogger.child.mockReturnValue(mockLogger);

describe('backfillCredentialDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (decodeJwt as jest.Mock).mockImplementation(decodeCompactJwt);
    mockGetBridge.mockImplementation((type: string, version: string) =>
      jest.requireActual('@uncefact/untp-ri-services/data-model-bridges').getBridge(type, version),
    );
  });

  it('transitions a pending row to EXTRACTED with details and the derived version', async () => {
    const rows = [pendingRow()];
    const client = createFakeClient(rows);

    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(enveloped(dppPayload())) });

    expect(result).toEqual({
      dryRun: false,
      scanned: 1,
      updated: 1,
      failed: 0,
      failures: [],
    });
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(rows[0].coreDataModelVersion).toBe('0.6.1');
    expect(rows[0].name).toBe('Wool Passport');
    expect(rows[0].issuerName).toBe('Example Issuer');
    expect(rows[0].issuerDid).toBe('did:web:issuer.example');
    expect(rows[0].subjectName).toBe('Merino batch');
    expect(rows[0].subjectId).toBe('https://example.com/product/1');
    expect(rows[0].validFrom).toEqual(new Date('2024-01-15T00:00:00.000Z'));
    expect(rows[0].validUntil).toEqual(new Date('2025-01-15T00:00:00.000Z'));
    expect(rows[0].detailsError).toBeNull();
  });

  it('never selects an already-EXTRACTED row', async () => {
    const rows = [
      pendingRow({
        id: 'cred-extracted',
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
        name: 'Already captured',
        coreDataModelVersion: '0.6.1',
      }),
    ];
    const client = createFakeClient(rows);
    const fetchArtifact = fetchJson(enveloped(dppPayload()));

    const result = await backfillCredentialDetails(client, { fetchArtifact });

    expect(result.scanned).toBe(0);
    expect(result.updated).toBe(0);
    expect(fetchArtifact).not.toHaveBeenCalled();
    expect(client.credential.updateMany).not.toHaveBeenCalled();
    expect(rows[0].name).toBe('Already captured');
  });

  it('reports zero rows changed on a second run', async () => {
    const rows = [pendingRow()];
    const client = createFakeClient(rows);
    const fetchArtifact = fetchJson(enveloped(dppPayload()));

    const first = await backfillCredentialDetails(client, { fetchArtifact });
    const second = await backfillCredentialDetails(client, { fetchArtifact });

    expect(first.updated).toBe(1);
    expect(second).toEqual({
      dryRun: false,
      scanned: 0,
      updated: 0,
      failed: 0,
      failures: [],
    });
    expect(client.credential.updateMany).toHaveBeenCalledTimes(1);
  });

  it('marks fetch failure as UNREADABLE_ENVELOPE and keeps going', async () => {
    const rows = [pendingRow({ id: 'cred-bad' }), pendingRow({ id: 'cred-good' })];
    const client = createFakeClient(rows);
    const fetchArtifact = jest.fn(async (uri: string) => {
      if (uri.includes('cred-bad')) {
        throw new Error('network error');
      }
      return JSON.stringify(enveloped(dppPayload()));
    });

    const result = await backfillCredentialDetails(client, { fetchArtifact });

    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      {
        id: 'cred-bad',
        errorClass: CredentialDetailsError.UNREADABLE_ENVELOPE,
        message: 'network error',
      },
    ]);
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
    expect(rows[0].detailsError).toBe(CredentialDetailsError.UNREADABLE_ENVELOPE);
    expect(rows[1].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(rows[1].coreDataModelVersion).toBe('0.6.1');
  });

  it('marks decrypt failure as DECRYPT_FAILED', async () => {
    const storageKey = 'b'.repeat(64);
    const adapter = new AesGcmEncryptionAdapter(storageKey, mockLogger as never);
    const envelope = adapter.encrypt(JSON.stringify(enveloped(dppPayload())), EncryptionAlgorithm.AES_256_GCM);
    const rows = [pendingRow({ decryptionKey: 'c'.repeat(64) })];
    const client = createFakeClient(rows);

    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(envelope) });

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toEqual(
      expect.objectContaining({
        id: 'cred-1',
        errorClass: CredentialDetailsError.DECRYPT_FAILED,
      }),
    );
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
    expect(rows[0].detailsError).toBe(CredentialDetailsError.DECRYPT_FAILED);
    expect(rows[0].coreDataModelVersion).toBeNull();
  });

  it('decrypts an at-rest wrapped key and extracts the credential', async () => {
    const storageKey = 'b'.repeat(64);
    const adapter = new AesGcmEncryptionAdapter(storageKey, mockLogger as never);
    const envelope = adapter.encrypt(JSON.stringify(enveloped(dppPayload())), EncryptionAlgorithm.AES_256_GCM);
    const rows = [pendingRow({ decryptionKey: protectDecryptionKey(storageKey) })];
    const client = createFakeClient(rows);

    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(envelope) });

    expect(result.failed).toBe(0);
    expect(result.updated).toBe(1);
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(rows[0].coreDataModelVersion).toBe('0.6.1');
    expect(rows[0].name).toBe('Wool Passport');
  });

  it('marks an unmatched @context as BRIDGE_ERROR', async () => {
    const rows = [pendingRow()];
    const client = createFakeClient(rows);
    const payload = dppPayload({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
    });

    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(enveloped(payload)) });

    expect(result.failures[0]).toEqual(
      expect.objectContaining({
        id: 'cred-1',
        errorClass: CredentialDetailsError.BRIDGE_ERROR,
      }),
    );
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
    expect(rows[0].coreDataModelVersion).toBeNull();
  });

  it('marks an ambiguous @context as BRIDGE_ERROR rather than guessing', async () => {
    const rows = [pendingRow()];
    const client = createFakeClient(rows);
    const payload = dppPayload({
      '@context': ['https://www.w3.org/ns/credentials/v2', DPP_060_CONTEXT, DPP_061_CONTEXT],
    });

    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(enveloped(payload)) });

    expect(result.failures[0]).toEqual(
      expect.objectContaining({
        id: 'cred-1',
        errorClass: CredentialDetailsError.BRIDGE_ERROR,
        message: expect.stringContaining('Ambiguous'),
      }),
    );
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
    expect(rows[0].coreDataModelVersion).toBeNull();
  });

  it('uses a stored coreDataModelVersion instead of deriving from @context', async () => {
    const rows = [pendingRow({ coreDataModelVersion: '0.6.0' })];
    const client = createFakeClient(rows);
    // Context would uniquely match 0.6.1; the stored version must win.
    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(enveloped(dppPayload())) });

    expect(result.updated).toBe(1);
    expect(rows[0].coreDataModelVersion).toBe('0.6.0');
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
  });

  it('marks a throwing extractor as BRIDGE_ERROR', async () => {
    mockGetBridge.mockReturnValue({
      extractSubjectSummary: () => {
        throw new Error('bridge defect');
      },
    } as never);
    const rows = [pendingRow({ coreDataModelVersion: '0.6.1' })];
    const client = createFakeClient(rows);

    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(enveloped(dppPayload())) });

    expect(result.failures[0]).toEqual({
      id: 'cred-1',
      errorClass: CredentialDetailsError.BRIDGE_ERROR,
      message: 'bridge defect',
    });
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
  });

  it('marks a stored version with no registered bridge as BRIDGE_ERROR', async () => {
    const rows = [pendingRow({ coreDataModelVersion: '9.9.9' })];
    const client = createFakeClient(rows);

    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(enveloped(dppPayload())) });

    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        id: rows[0].id,
        errorClass: CredentialDetailsError.BRIDGE_ERROR,
        message: expect.stringContaining('No bridge registered'),
      }),
    ]);
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
  });

  it('marks a structurally corrupted encrypted payload as UNREADABLE_ENVELOPE', async () => {
    const rows = [pendingRow({ decryptionKey: 'a'.repeat(64) })];
    const client = createFakeClient(rows);

    const truncatedIv = Buffer.from('short').toString('base64');
    const result = await backfillCredentialDetails(client, {
      fetchArtifact: fetchJson({
        cipherText: Buffer.from('ciphertext').toString('base64'),
        iv: truncatedIv,
        tag: Buffer.from('0123456789abcdef').toString('base64'),
        type: 'aes-256-gcm',
      }),
    });

    expect(result.failures).toEqual([
      expect.objectContaining({
        id: rows[0].id,
        errorClass: CredentialDetailsError.UNREADABLE_ENVELOPE,
        message: 'The stored credential data is corrupted and cannot be decrypted',
      }),
    ]);
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
  });

  it('enumerates a failed failure-marker write in the report and continues the batch', async () => {
    const rows = [
      pendingRow({ id: 'cred-a', storageUri: 'https://storage.example/broken' }),
      pendingRow({ id: 'cred-b' }),
    ];
    const client = createFakeClient(rows);
    const goodBody = JSON.stringify(enveloped(dppPayload()));
    const fetchArtifact = jest.fn(async (uri: string) => {
      if (uri.endsWith('broken')) throw new Error('storage unreachable');
      return goodBody;
    });
    (client.credential.updateMany as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('connection dropped');
    });

    const result = await backfillCredentialDetails(client, { fetchArtifact });

    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({ id: 'cred-a', message: expect.stringContaining('storage unreachable') }),
      expect.objectContaining({ id: 'cred-a', message: expect.stringContaining("Failed to write the row's outcome") }),
    ]);
    expect(rows[1].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
  });

  it('reports a failed success write as a failure and leaves the row pending for a re-run', async () => {
    const rows = [pendingRow()];
    const client = createFakeClient(rows);
    (client.credential.updateMany as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('connection dropped');
    });

    const result = await backfillCredentialDetails(client, { fetchArtifact: fetchJson(enveloped(dppPayload())) });

    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        id: rows[0].id,
        message: expect.stringContaining("Failed to write the row's outcome"),
      }),
    ]);
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_PENDING);
  });

  it('does not abort the batch when one row fails', async () => {
    const rows = [pendingRow({ id: 'cred-a' }), pendingRow({ id: 'cred-b' }), pendingRow({ id: 'cred-c' })];
    const client = createFakeClient(rows);
    const fetchArtifact = jest.fn(async (uri: string) => {
      if (uri.includes('cred-b')) {
        return 'not-json';
      }
      return JSON.stringify(enveloped(dppPayload()));
    });

    const result = await backfillCredentialDetails(client, { fetchArtifact });

    expect(result.scanned).toBe(3);
    expect(result.updated).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures.map((failure) => failure.id)).toEqual(['cred-b']);
    expect(rows.map((row) => row.detailsStatus)).toEqual([
      CredentialDetailsStatus.EXTRACTED,
      CredentialDetailsStatus.EXTRACTION_FAILED,
      CredentialDetailsStatus.EXTRACTED,
    ]);
  });

  it('performs no writes in dry-run and still reports the same counts', async () => {
    const rows = [pendingRow({ id: 'cred-ok' }), pendingRow({ id: 'cred-bad' })];
    const client = createFakeClient(rows);
    const fetchArtifact = jest.fn(async (uri: string) => {
      if (uri.includes('cred-bad')) {
        throw new Error('network error');
      }
      return JSON.stringify(enveloped(dppPayload()));
    });

    const result = await backfillCredentialDetails(client, { dryRun: true, fetchArtifact });

    expect(result).toEqual({
      dryRun: true,
      scanned: 2,
      updated: 1,
      failed: 1,
      failures: [
        {
          id: 'cred-bad',
          errorClass: CredentialDetailsError.UNREADABLE_ENVELOPE,
          message: 'network error',
        },
      ],
    });
    expect(client.credential.updateMany).not.toHaveBeenCalled();
    expect(rows[0].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_PENDING);
    expect(rows[1].detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_PENDING);
    expect(rows[0].coreDataModelVersion).toBeNull();
  });
});
