import { spawnSync } from 'node:child_process';
import path from 'node:path';

const scriptPath = path.resolve(process.cwd(), 'scripts/inspect-credential-batch-item.ts');

function runScript(args: readonly string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runScriptWithArgv(argv: readonly string[]) {
  const source = `process.argv = ${JSON.stringify(argv)}; await import(${JSON.stringify(scriptPath)});`;
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runScriptWithRepositoryMock(argv: readonly string[]) {
  const mockModule =
    'export async function runInspectCredentialBatchItem() { globalThis.__repositoryMockCalled = true; return 0; }';
  const mockModuleUrl = `data:text/javascript,${encodeURIComponent(mockModule)}`;
  const source = [
    "import { registerHooks } from 'node:module';",
    `registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/src/lib/credentials/credential-batch-operator.js')) {
    return { url: ${JSON.stringify(mockModuleUrl)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });`,
    `process.argv = ${JSON.stringify(argv)};`,
    `await import(${JSON.stringify(scriptPath)});`,
    "if (globalThis.__repositoryMockCalled !== true) { console.error('repository mock was not called'); process.exitCode = 3; } else { console.error('repository mock was called'); }",
  ].join('\n');
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runScriptWithRepositoryMockAndExpectNotCalled(argv: readonly string[]) {
  const mockModule =
    'export async function runInspectCredentialBatchItem() { globalThis.__repositoryMockCalled = true; return 0; }';
  const mockModuleUrl = `data:text/javascript,${encodeURIComponent(mockModule)}`;
  const source = [
    "import { registerHooks } from 'node:module';",
    `registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/src/lib/credentials/credential-batch-operator.js')) {
    return { url: ${JSON.stringify(mockModuleUrl)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });`,
    `process.argv = ${JSON.stringify(argv)};`,
    `await import(${JSON.stringify(scriptPath)});`,
    "if (globalThis.__repositoryMockCalled === true) { console.error('repository mock was called'); process.exitCode = 2; }",
  ].join('\n');
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runScriptWithFallbackRepositoryMock(argv: readonly string[]) {
  const mockModule = `
export async function getCredentialBatchItemForInspection() {
  return {
    tenantId: 'tenant-1', batchId: 'batch-1', batchCorrelationId: 'b'.repeat(128),
    itemCorrelationId: '(not derivable; search by batchCorrelationId and index)', index: 17,
    batchState: 'NEEDS_ATTENTION', batchVersion: 7, requestDigest: 'digest',
    createdAt: new Date('2026-09-17T00:00:00.000Z'), settledAt: new Date('2026-09-17T01:00:00.000Z'),
    resolvedAt: null, itemState: 'OUTCOME_UNKNOWN', itemUpdatedAt: new Date('2026-09-17T01:00:01.000Z'),
    credentialId: null, errorClass: 'OUTCOME_UNKNOWN', errorMessage: 'check the library',
    resolutionReason: null, itemResolvedAt: null, reference: null, encryptedRequest: 'encrypted-request'
  };
}
export function decryptCredentialBatchItemRequest() { return '{}'; }
export async function resolveUnknownBatchItem() { return { outcome: 'missing' }; }
export function buildCredentialBatchResolutionAudit() { return {}; }
`;
  const mockModuleUrl = `data:text/javascript,${encodeURIComponent(mockModule)}`;
  const source = [
    "import { registerHooks } from 'node:module';",
    `registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.includes('credential-batch.repository')) {
    return { url: ${JSON.stringify(mockModuleUrl)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });`,
    `process.argv = ${JSON.stringify(argv)};`,
    `await import(${JSON.stringify(scriptPath)});`,
  ].join('\n');
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function expectOneLineError(result: ReturnType<typeof spawnSync>, message: string): void {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`${message}\n`);
  expect(result.stderr).not.toContain('    at ');
}

const argumentErrors = [
  {
    name: 'a missing tenant',
    args: ['--batch', 'batch-1', '--index=0'],
    message: '--tenant is required',
  },
  {
    name: 'a blank tenant',
    args: ['--tenant', '', '--batch', 'batch-1', '--index=0'],
    message: '--tenant is required',
  },
  {
    name: 'a missing batch',
    args: ['--tenant', 'tenant-1', '--index=0'],
    message: '--batch is required',
  },
  {
    name: 'a blank batch',
    args: ['--tenant', 'tenant-1', '--batch', '  ', '--index=0'],
    message: '--batch is required',
  },
  {
    name: 'a missing index',
    args: ['--tenant', 'tenant-1', '--batch', 'batch-1'],
    message: '--index is required',
  },
  {
    name: 'a non-numeric index',
    args: ['--tenant', 'tenant-1', '--batch', 'batch-1', '--index', 'abc'],
    message: '--index must be a non-negative integer',
  },
  {
    name: 'a negative index in equals form',
    args: ['--tenant', 'tenant-1', '--batch', 'batch-1', '--index=-1'],
    message: '--index must be a non-negative integer',
  },
  {
    name: 'an index outside the safe integer range',
    args: ['--tenant', 'tenant-1', '--batch', 'batch-1', '--index=9007199254740992'],
    message: '--index is outside the safe integer range',
  },
] as const;

describe('inspect-credential-batch-item argument guard', () => {
  it.each(argumentErrors)('prints one line for $name', ({ args, message }) => {
    // Regression: an argument throw must use the CLI catch instead of exposing a Node stack trace.
    expectOneLineError(runScript(args), message);
  });

  it('prints one line for a NUL in --tenant', () => {
    // Regression: the NUL guard must have the same caught error contract as other argument checks.
    const result = runScriptWithArgv([
      'node',
      'script',
      '--tenant',
      `tenant-${String.fromCharCode(0)}-invalid`,
      '--batch',
      'batch-1',
      '--index=0',
    ]);

    expectOneLineError(result, '--tenant must not contain a NUL character');
  });

  it('prints one line for a NUL in --batch', () => {
    // Regression: the batch NUL guard must not escape before the CLI catch either.
    const result = runScriptWithArgv([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      `batch-${String.fromCharCode(0)}-invalid`,
      '--index=0',
    ]);

    expectOneLineError(result, '--batch must not contain a NUL character');
  });

  it('prints one line for a NUL in --reason without calling the operator', () => {
    // Regression: inspection reasons must use the same NUL guard as tenant and batch identifiers.
    const result = runScriptWithRepositoryMockAndExpectNotCalled([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--reason',
      `ticket-${String.fromCharCode(0)}-invalid`,
    ]);

    expectOneLineError(result, '--reason must not contain a NUL character');
  });

  it('refuses a supplied blank inspection reason without calling the operator', () => {
    // Regression: an explicitly supplied blank reason must not silently become the default audit reason.
    const result = runScriptWithRepositoryMockAndExpectNotCalled([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--reason',
      '  ',
    ]);

    expectOneLineError(result, '--reason is required');
  });

  it('reaches the repository mock for valid arguments', () => {
    // Regression: changing the operator repository module path or dropping its import must break this positive control.
    const result = runScriptWithRepositoryMock([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('repository mock was called\n');
  });

  it('prints the repository fallback for an item id that cannot be derived', () => {
    // Regression: the inspection command must preserve the operator guidance for an unloggable derived id.
    const result = runScriptWithFallbackRepositoryMock([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=17',
    ]);

    expect(result.status).toBe(0);
    const printed = result.stdout.split('\n').find((line) => line.includes('"itemCorrelationId"'));
    expect(printed).toBeDefined();
    expect(JSON.parse(printed as string)).toMatchObject({
      batchCorrelationId: 'b'.repeat(128),
      itemCorrelationId: '(not derivable; search by batchCorrelationId and index)',
      index: 17,
    });
  });
});
