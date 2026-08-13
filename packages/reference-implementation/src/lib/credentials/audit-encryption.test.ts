export {};

jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const originalEnv = process.env;

const ACTIVE_KEY = 'a'.repeat(64);
const OTHER_KEY = 'd'.repeat(64);

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, DATA_ENCRYPTION_KEY: ACTIVE_KEY };
});

afterAll(() => {
  process.env = originalEnv;
});

type Row = { id: string; decryptionKey: string | null };
type ServiceInstanceRow = { id: string; config: string };

function createFakeClient(rows: Row[], serviceInstances: ServiceInstanceRow[] = []) {
  return {
    credential: {
      findMany: jest.fn(
        async (args: { where: { decryptionKey: { not: null }; id?: { gt: string } }; take: number }): Promise<Row[]> =>
          rows
            .filter((row) => row.decryptionKey !== null)
            .filter((row) => (args.where.id ? row.id > args.where.id.gt : true))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, args.take)
            .map((row) => ({ id: row.id, decryptionKey: row.decryptionKey })),
      ),
      update: jest.fn(async () => {
        throw new Error('the audit must never write');
      }),
    },
    serviceInstance: {
      findMany: jest.fn(
        async (args: { where?: { id?: { gt: string } }; take: number }): Promise<ServiceInstanceRow[]> =>
          serviceInstances
            .filter((row) => (args.where?.id ? row.id > args.where.id.gt : true))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, args.take)
            .map((row) => ({ id: row.id, config: row.config })),
      ),
    },
  };
}

async function activeService() {
  const { getEncryptionService } = await import('../encryption/encryption');
  return getEncryptionService();
}

/** An envelope produced under a key other than the active DATA_ENCRYPTION_KEY. */
async function envelopeUnderOtherKey(plaintext: string): Promise<string> {
  const { AesGcmEncryptionAdapter, EncryptionAlgorithm } = await import('@uncefact/untp-ri-services/encryption');
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  const adapter = new AesGcmEncryptionAdapter(OTHER_KEY, logger as never);
  return JSON.stringify(adapter.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM));
}

describe('auditEncryption', () => {
  it('reports all clean and a verified key when every envelope decrypts', async () => {
    const { auditEncryption, auditFoundProblems } = await import('./audit-encryption');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: protectDecryptionKey('b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: null },
    ];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: protectDecryptionKey('{"apiUrl":"x"}') }];
    const client = createFakeClient(rows, serviceInstances);

    const result = await auditEncryption(client, await activeService());

    expect(result).toEqual({
      keyVerified: true,
      serviceInstances: { okCount: 1, decryptFailedIds: [], corruptedIds: [] },
      credentials: { okCount: 1, decryptFailedIds: [], suspectRowIds: [], wrappablePlaintextCount: 0 },
    });
    expect(auditFoundProblems(result)).toBe(false);
  });

  it('collects every decrypt failure across both stores without aborting mid-scan', async () => {
    const { auditEncryption, auditFoundProblems } = await import('./audit-encryption');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnderOtherKey('b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: protectDecryptionKey('c'.repeat(64)) },
      { id: 'cred-3', decryptionKey: await envelopeUnderOtherKey('e'.repeat(64)) },
    ];
    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-1', config: await envelopeUnderOtherKey('{"a":1}') },
      { id: 'svc-2', config: protectDecryptionKey('{"b":2}') },
    ];
    const client = createFakeClient(rows, serviceInstances);

    const result = await auditEncryption(client, await activeService());

    expect(result.serviceInstances).toEqual({ okCount: 1, decryptFailedIds: ['svc-1'], corruptedIds: [] });
    expect(result.credentials.decryptFailedIds).toEqual(['cred-1', 'cred-3']);
    expect(result.credentials.okCount).toBe(1);
    expect(result.keyVerified).toBe(true);
    expect(auditFoundProblems(result)).toBe(true);
    // The first failure's original error rides along for cause-chaining.
    expect(result.firstDecryptFailure?.rowDescription).toBe('service instance svc-1');
    // Duck-typed: the services package throws from another realm under jest,
    // so instanceof Error is unreliable here.
    expect((result.firstDecryptFailure?.error as { message?: unknown })?.message).toEqual(expect.any(String));
  });

  it('classifies any non-envelope service configuration as corrupted, whatever it looks like', async () => {
    const { auditEncryption } = await import('./audit-encryption');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-1', config: '' },
      { id: 'svc-2', config: 'plain text' },
      { id: 'svc-3', config: '[]' },
      { id: 'svc-4', config: '{"cipherText":"tru' },
      { id: 'svc-5', config: '{"cipherText":null,"iv":null,"tag":null,"type":null}' },
      { id: 'svc-6', config: protectDecryptionKey('{"ok":true}') },
    ];
    const client = createFakeClient([], serviceInstances);

    const result = await auditEncryption(client, await activeService());

    expect(result.serviceInstances.corruptedIds).toEqual(['svc-1', 'svc-2', 'svc-3', 'svc-4', 'svc-5']);
    expect(result.serviceInstances.okCount).toBe(1);
  });

  it('classifies credential values per the backfill taxonomy: suspect, plaintext, or decrypt failure', async () => {
    const { auditEncryption } = await import('./audit-encryption');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: '{"cipherText":"q1w2' },
      { id: 'cred-2', decryptionKey: 'b'.repeat(64) },
      { id: 'cred-3', decryptionKey: '' },
      { id: 'cred-4', decryptionKey: await envelopeUnderOtherKey('c'.repeat(64)) },
      { id: 'cred-5', decryptionKey: null },
    ];
    const client = createFakeClient(rows);

    const result = await auditEncryption(client, await activeService());

    expect(result.credentials.suspectRowIds).toEqual(['cred-1']);
    expect(result.credentials.wrappablePlaintextCount).toBe(2);
    expect(result.credentials.decryptFailedIds).toEqual(['cred-4']);
    expect(result.credentials.okCount).toBe(0);
  });

  it('reports an unverified key on empty stores and on plaintext-only stores', async () => {
    const { auditEncryption, auditFoundProblems } = await import('./audit-encryption');

    const empty = await auditEncryption(createFakeClient([]), await activeService());
    expect(empty.keyVerified).toBe(false);
    expect(auditFoundProblems(empty)).toBe(false);

    const plaintextOnly = await auditEncryption(
      createFakeClient([{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }]),
      await activeService(),
    );
    expect(plaintextOnly.keyVerified).toBe(false);
    expect(plaintextOnly.credentials.wrappablePlaintextCount).toBe(1);
    expect(auditFoundProblems(plaintextOnly)).toBe(false);
  });

  it('decrypts with the injected service, not the environment', async () => {
    const { auditEncryption } = await import('./audit-encryption');
    const { AesGcmEncryptionAdapter } = await import('@uncefact/untp-ri-services/encryption');

    // An envelope written under OTHER_KEY fails under the active env key but
    // must decrypt cleanly when an OTHER_KEY-built service is injected: the
    // shape #720's rotation preflight relies on.
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnderOtherKey('b'.repeat(64)) }];
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
    logger.child.mockReturnValue(logger);
    const outgoingKeyService = new AesGcmEncryptionAdapter(OTHER_KEY, logger as never);

    const result = await auditEncryption(createFakeClient(rows), outgoingKeyService);

    expect(result.credentials.okCount).toBe(1);
    expect(result.credentials.decryptFailedIds).toEqual([]);
    expect(result.keyVerified).toBe(true);
  });

  describe('buildAuditReport', () => {
    const DOCS = 'https://docs.example/audit';

    function baseResult() {
      return {
        keyVerified: true,
        serviceInstances: { okCount: 0, decryptFailedIds: [] as string[], corruptedIds: [] as string[] },
        credentials: {
          okCount: 0,
          decryptFailedIds: [] as string[],
          suspectRowIds: [] as string[],
          wrappablePlaintextCount: 0,
        },
      };
    }

    it('exits 0 on a clean verified result without the nothing-to-verify note', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.serviceInstances.okCount = 2;
      result.credentials.okCount = 3;

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(0);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).toContain('all stored envelopes decrypted cleanly');
      expect(text).not.toContain('nothing existed to verify');
    });

    it('exits 1 and lists ids on stderr when findings exist', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.serviceInstances.corruptedIds = ['si-corrupt'];
      result.credentials.suspectRowIds = ['cred-suspect'];

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(1);
      const errText = report.lines
        .filter((line) => line.stream === 'err')
        .map((line) => line.text)
        .join('\n');
      expect(errText).toContain('si-corrupt');
      expect(errText).toContain('cred-suspect');
      expect(errText).toContain(DOCS);
    });

    it('omits the nothing-to-verify note on a wrong key, where envelopes existed but all failed', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.keyVerified = false;
      result.serviceInstances.decryptFailedIds = ['si-1'];
      result.credentials.decryptFailedIds = ['cred-1', 'cred-2'];

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(1);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).not.toContain('nothing existed to verify');
      const errText = report.lines
        .filter((line) => line.stream === 'err')
        .map((line) => line.text)
        .join('\n');
      expect(errText).toContain('failed to decrypt');
      expect(errText).toContain('si-1');
      expect(errText).toContain('cred-1, cred-2');
    });

    it('reports that a backfill would abort, never offering --force, when a service config is corrupted', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.keyVerified = false;
      result.serviceInstances.corruptedIds = ['si-corrupt'];
      result.credentials.wrappablePlaintextCount = 2;

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(1);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).toContain('would abort before any write');
      expect(text).toContain('2 plaintext key(s) are otherwise wrappable');
      expect(text).not.toContain('--force');
      expect(text).not.toContain('would wrap');
    });

    it('reports the abort, not a wrap count, when a verified key coexists with a decrypt failure', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.serviceInstances.okCount = 1;
      result.credentials.decryptFailedIds = ['cred-bad'];
      result.credentials.wrappablePlaintextCount = 3;

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(1);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).toContain('would abort before any write');
      expect(text).not.toContain('would wrap 3');
      expect(text).not.toContain('--force');
    });

    it('still prints the abort dry-run line when nothing is wrappable', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.keyVerified = false;
      result.credentials.decryptFailedIds = ['cred-bad'];

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(1);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).toContain('would abort before any write');
      expect(text).not.toContain('--force');
    });

    it('does not call a dirty structural-findings-only run clean in the nothing-to-verify note', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.keyVerified = false;
      result.credentials.suspectRowIds = ['cred-suspect'];

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(1);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).toContain('nothing existed to verify');
      expect(text).not.toContain('a clean result here');
    });

    it('prints the nothing-to-verify note, exiting 0, when no envelope existed at all', async () => {
      const { buildAuditReport } = await import('./audit-encryption');

      const result = baseResult();
      result.keyVerified = false;

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(0);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).toContain('nothing existed to verify');
    });

    it('states the force refusal in the dry run when plaintext exists and the key is unproven', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.keyVerified = false;
      result.credentials.wrappablePlaintextCount = 2;

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(0);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).toContain('would wrap 2 plaintext key(s), but would refuse without --force');
    });

    it('states a plain dry-run wrap count when the key is verified', async () => {
      const { buildAuditReport } = await import('./audit-encryption');
      const result = baseResult();
      result.serviceInstances.okCount = 1;
      result.credentials.wrappablePlaintextCount = 3;

      const report = buildAuditReport(result, DOCS);

      expect(report.exitCode).toBe(0);
      const text = report.lines.map((line) => line.text).join('\n');
      expect(text).toContain('would wrap 3 plaintext key(s).');
      expect(text).not.toContain('--force');
    });
  });

  it('never writes, and paginates past a single batch', async () => {
    const { auditEncryption } = await import('./audit-encryption');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = Array.from({ length: 150 }, (_, index) => ({
      id: `cred-${String(index).padStart(3, '0')}`,
      decryptionKey: protectDecryptionKey('b'.repeat(64)),
    }));
    const serviceInstances: ServiceInstanceRow[] = Array.from({ length: 120 }, (_, index) => ({
      id: `svc-${String(index).padStart(3, '0')}`,
      config: protectDecryptionKey('{"x":1}'),
    }));
    const client = createFakeClient(rows, serviceInstances);

    const result = await auditEncryption(client, await activeService());

    expect(result.credentials.okCount).toBe(150);
    expect(result.serviceInstances.okCount).toBe(120);
    expect(client.credential.update).not.toHaveBeenCalled();
    expect(client.credential.findMany.mock.calls.length).toBeGreaterThan(1);
    expect(client.serviceInstance.findMany.mock.calls.length).toBeGreaterThan(1);
  });
});
