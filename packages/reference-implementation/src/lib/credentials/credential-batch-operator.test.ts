import { CredentialBatchItemState, CredentialBatchState } from '@/lib/prisma/generated';
import {
  runInspectCredentialBatchItem,
  runResolveCredentialBatchItem,
  type InspectCredentialBatchItemOptions,
  type OperatorOutput,
  type ResolveCredentialBatchItemOptions,
} from './credential-batch-operator';

function outputRecorder() {
  const events: string[] = [];
  const output: OperatorOutput = {
    print: (line) => events.push(`print:${line}`),
    printError: (line) => events.push(`error:${line}`),
  };
  return { events, output };
}

function inspectOptions(overrides: Partial<InspectCredentialBatchItemOptions> = {}): InspectCredentialBatchItemOptions {
  return {
    tenantId: 'tenant-1',
    batchId: 'batch-1',
    index: 0,
    reason: 'INC-123',
    discloseRequest: false,
    ...overrides,
  };
}

const item = {
  tenantId: 'tenant-1',
  batchId: 'batch-1',
  index: 0,
  batchState: CredentialBatchState.NEEDS_ATTENTION,
  batchVersion: 7,
  requestDigest: 'zbatch-digest',
  createdAt: new Date('2026-09-17T00:00:00.000Z'),
  settledAt: new Date('2026-09-17T01:00:00.000Z'),
  resolvedAt: null,
  itemState: CredentialBatchItemState.OUTCOME_UNKNOWN,
  itemUpdatedAt: new Date('2026-09-17T01:00:01.000Z'),
  credentialId: 'credential-1',
  errorClass: 'OUTCOME_UNKNOWN',
  errorMessage: 'check the library',
  resolutionReason: null,
  itemResolvedAt: null,
  encryptedRequest: 'encrypted-request',
};

it('prints the minimal inspection shape and audits before metadata output', async () => {
  const { events, output } = outputRecorder();
  const logger = { info: jest.fn(), warn: jest.fn(() => events.push('audit:warn')) };
  const getItem = jest.fn().mockResolvedValue(item);

  await expect(
    runInspectCredentialBatchItem(inspectOptions(), {
      getItem,
      logger,
      output,
      now: () => new Date('2026-09-17T02:00:00.000Z'),
    }),
  ).resolves.toBe(0);

  expect(events[0]).toBe('audit:warn');
  const printed = JSON.parse(events[1].slice('print:'.length)) as Record<string, unknown>;
  expect(printed).toEqual({
    tenantId: 'tenant-1',
    batchId: 'batch-1',
    index: 0,
    batchState: 'NEEDS_ATTENTION',
    batchVersion: 7,
    itemState: 'OUTCOME_UNKNOWN',
    createdAt: '2026-09-17T00:00:00.000Z',
    settledAt: '2026-09-17T01:00:00.000Z',
    resolvedAt: null,
    resolutionReason: null,
    itemResolvedAt: null,
    itemUpdatedAt: '2026-09-17T01:00:01.000Z',
    credentialId: 'credential-1',
    error: { code: 'OUTCOME_UNKNOWN', message: 'check the library' },
    requestDigest: 'zbatch-digest',
  });
  expect(JSON.stringify(events)).not.toContain('encrypted-request');
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'inspect',
      outcome: 'found',
      disclosure: 'identifiers',
      version: 7,
      at: '2026-09-17T02:00:00.000Z',
    }),
    'Credential batch operator audit',
  );
  const audit = (logger.warn.mock.calls[0] as unknown[])[0];
  expect(audit).not.toHaveProperty('operator');
});

it('audits before printing the decrypted request and never sends plaintext to the logger', async () => {
  const { events, output } = outputRecorder();
  const logger = { info: jest.fn(), warn: jest.fn(() => events.push('audit:warn')) };

  await expect(
    runInspectCredentialBatchItem(inspectOptions({ discloseRequest: true }), {
      getItem: jest.fn().mockResolvedValue(item),
      decrypt: jest.fn(() => JSON.stringify({ issuer: 'did:example:issuer', secret: 'plaintext' })),
      logger,
      output,
      now: () => new Date('2026-09-17T02:00:00.000Z'),
    }),
  ).resolves.toBe(0);

  expect(events[0]).toBe('audit:warn');
  expect(events[1]).toContain('OUTCOME_UNKNOWN');
  expect(events[2]).toBe('print:request: {"issuer":"did:example:issuer","secret":"plaintext"}');
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('plaintext');
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ disclosure: 'full', outcome: 'found' }),
    'Credential batch operator audit',
  );
});

it('warns and exits non-zero for a missing tenant-owned item', async () => {
  const { events, output } = outputRecorder();
  const logger = { info: jest.fn(), warn: jest.fn(() => events.push('audit:warn')) };

  await expect(
    runInspectCredentialBatchItem(inspectOptions(), {
      getItem: jest.fn().mockResolvedValue(null),
      logger,
      output,
      now: () => new Date('2026-09-17T02:00:00.000Z'),
    }),
  ).resolves.toBe(1);
  expect(events).toEqual(['audit:warn', 'error:Credential batch item was not found for this tenant.']);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: 'missing', disclosure: 'identifiers' }),
    'Credential batch operator audit',
  );
});

it('audits a decryption failure without logging its exception text and exits non-zero', async () => {
  const { events, output } = outputRecorder();
  const logger = { info: jest.fn(), warn: jest.fn(() => events.push('audit:warn')) };

  await expect(
    runInspectCredentialBatchItem(inspectOptions({ discloseRequest: true }), {
      getItem: jest.fn().mockResolvedValue(item),
      decrypt: jest.fn(() => {
        throw new Error('secret envelope detail');
      }),
      logger,
      output,
      now: () => new Date('2026-09-17T02:00:00.000Z'),
    }),
  ).resolves.toBe(1);
  expect(events).toEqual(['audit:warn', 'error:Credential batch item request could not be decrypted.']);
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret envelope detail');
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: 'decryption-failed', disclosure: 'full' }),
    'Credential batch operator audit',
  );
});

it('prints transactional resolution before and after states', async () => {
  const { events, output } = outputRecorder();
  const logger = { info: jest.fn(), warn: jest.fn(() => events.push('audit:warn')) };
  const before = {
    batchState: CredentialBatchState.NEEDS_ATTENTION,
    batchVersion: 7,
    counts: { total: 1, queued: 0, processing: 0, issued: 0, failed: 0, unknown: 1 },
    itemState: CredentialBatchItemState.OUTCOME_UNKNOWN,
    credentialId: null,
    errorClass: 'OUTCOME_UNKNOWN',
    errorMessage: 'check the library',
    createdAt: new Date('2026-09-17T00:00:00.000Z'),
    settledAt: new Date('2026-09-17T01:00:00.000Z'),
    resolvedAt: null,
    expiresAt: null,
    itemUpdatedAt: new Date('2026-09-17T01:00:01.000Z'),
  };
  const after = {
    ...before,
    batchState: CredentialBatchState.COMPLETED,
    batchVersion: 8,
    counts: { total: 1, queued: 0, processing: 0, issued: 1, failed: 0, unknown: 0 },
    itemState: CredentialBatchItemState.ISSUED,
    credentialId: 'credential-1',
    errorClass: null,
    errorMessage: null,
    resolvedAt: new Date('2026-09-17T02:00:00.000Z'),
    expiresAt: new Date('2026-10-17T02:00:00.000Z'),
  };
  const options: ResolveCredentialBatchItemOptions = {
    tenantId: 'tenant-1',
    batchId: 'batch-1',
    index: 0,
    expectedVersion: 7,
    resolution: { state: 'ISSUED', credentialId: 'credential-1' },
    reason: 'INC-123',
    dryRun: false,
  };
  const result = {
    outcome: 'applied' as const,
    audit: {
      action: 'resolve' as const,
      tenantId: 'tenant-1',
      batchId: 'batch-1',
      index: 0,
      version: 7,
      resolution: 'ISSUED' as const,
      reason: 'INC-123',
      credentialId: 'credential-1',
    },
    before,
    after,
  };

  await expect(
    runResolveCredentialBatchItem(options, {
      transaction: async (callback) => callback({} as never),
      resolve: jest.fn().mockResolvedValue(result),
      logger,
      output,
      now: () => new Date('2026-09-17T02:00:00.000Z'),
    }),
  ).resolves.toBe(0);
  expect(events[0]).toBe('audit:warn');
  expect(events[1]).toContain('before:');
  expect(events[2]).toContain('after:');
});

it('refuses request disclosure when warn audit output would be filtered', async () => {
  // Regression: plaintext must never be printed when the configured level suppresses the required warn audit.
  const previous = process.env.LOG_LEVEL;
  const { events, output } = outputRecorder();
  const decrypt = jest.fn(() => JSON.stringify({ secret: 'plaintext' }));
  try {
    for (const level of ['error', 'fatal', 'silent']) {
      process.env.LOG_LEVEL = level;
      events.length = 0;
      decrypt.mockClear();
      await expect(
        runInspectCredentialBatchItem(inspectOptions({ discloseRequest: true }), {
          getItem: jest.fn().mockResolvedValue(item),
          decrypt,
          logger: { info: jest.fn(), warn: jest.fn() },
          output,
          now: () => new Date('2026-09-17T02:00:00.000Z'),
        }),
      ).resolves.toBe(1);
      expect(decrypt).not.toHaveBeenCalled();
      expect(events).toEqual(['error:Request disclosure requires LOG_LEVEL=warn or a more verbose level.']);
    }
  } finally {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
  }
});

it('does not print metadata or request plaintext when the required audit line cannot be emitted', async () => {
  // Regression: an audit transport failure must fail closed before any inspected data reaches output.
  const { events, output } = outputRecorder();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(() => {
      throw new Error('audit transport failed');
    }),
  };
  await expect(
    runInspectCredentialBatchItem(inspectOptions({ discloseRequest: true }), {
      getItem: jest.fn().mockResolvedValue(item),
      decrypt: jest.fn(() => JSON.stringify({ secret: 'plaintext' })),
      logger,
      output,
      now: () => new Date('2026-09-17T02:00:00.000Z'),
    }),
  ).resolves.toBe(1);
  expect(events).toEqual(['error:Credential batch item inspection could not be audited.']);
  expect(JSON.stringify(events)).not.toContain('plaintext');
});
