import { spawnSync } from 'node:child_process';
import path from 'node:path';

const scriptPath = path.resolve(process.cwd(), 'scripts/resolve-credential-batch-item.ts');

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
    'export async function runResolveCredentialBatchItem() { globalThis.__repositoryMockCalled = true; return 0; }';
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

function runScriptWithRepositoryMockAndExpectSuccess(argv: readonly string[]) {
  const mockModule =
    'export async function runResolveCredentialBatchItem() { globalThis.__repositoryMockCalled = true; return 0; }';
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

function runScriptWithRepositoryMockAndCaptureOptions(argv: readonly string[]) {
  const mockModule = `
export async function runResolveCredentialBatchItem(options) {
  console.log(JSON.stringify(options));
  return 0;
}
`;
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
    args: ['--batch', 'batch-1', '--index=0', '--version', '1', '--issued', 'credential-1', '--reason', 'ticket-1'],
    message: '--tenant is required',
  },
  {
    name: 'a blank tenant',
    args: [
      '--tenant',
      '',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--tenant is required',
  },
  {
    name: 'failed mode without a tenant',
    args: [
      '--failed',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--evidence',
      'ticket-1',
      '--reason',
      'ticket-1',
    ],
    message: '--tenant is required',
  },
  {
    name: 'a missing batch',
    args: ['--tenant', 'tenant-1', '--index=0', '--version', '1', '--issued', 'credential-1', '--reason', 'ticket-1'],
    message: '--batch is required',
  },
  {
    name: 'a blank batch',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      '  ',
      '--index=0',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--batch is required',
  },
  {
    name: 'a missing index',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--index is required',
  },
  {
    name: 'a non-numeric index',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index',
      'abc',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--index must be a non-negative integer',
  },
  {
    name: 'a negative index in equals form',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=-1',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--index must be a non-negative integer',
  },
  {
    name: 'an index outside the safe integer range',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=9007199254740992',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--index is outside the safe integer range',
  },
  {
    name: 'a missing version',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--version is required',
  },
  {
    name: 'a non-numeric version',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      'abc',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--version must be a non-negative integer',
  },
  {
    name: 'a negative version in equals form',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version=-1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--version must be a non-negative integer',
  },
  {
    name: 'a version outside the safe integer range',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version=9007199254740992',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ],
    message: '--version is outside the safe integer range',
  },
  {
    name: 'both resolution flags',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--failed',
      '--reason',
      'ticket-1',
    ],
    message: 'choose exactly one of --issued or --failed',
  },
  {
    name: 'neither resolution flag',
    args: ['--tenant', 'tenant-1', '--batch', 'batch-1', '--index=0', '--version', '1', '--reason', 'ticket-1'],
    message: 'choose exactly one of --issued or --failed',
  },
  {
    name: 'a blank issued value supplied with failed mode',
    args: ['--tenant', 'tenant-1', '--batch', 'batch-1', '--index=0', '--version', '1', '--failed', '--issued', ''],
    message: 'choose exactly one of --issued or --failed',
  },
  {
    name: 'a missing reason',
    args: ['--tenant', 'tenant-1', '--batch', 'batch-1', '--index=0', '--version', '1', '--issued', 'credential-1'],
    message: '--reason is required',
  },
  {
    name: 'a blank reason',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      '  ',
    ],
    message: '--reason is required',
  },
  {
    name: 'missing evidence in failed mode',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--failed',
      '--reason',
      'ticket-1',
    ],
    message: '--evidence is required',
  },
  {
    name: 'blank evidence in failed mode',
    args: [
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--failed',
      '--evidence',
      '',
      '--reason',
      'ticket-1',
    ],
    message: '--evidence is required',
  },
] as const;

describe('resolve-credential-batch-item argument guard', () => {
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
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
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
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ]);

    expectOneLineError(result, '--batch must not contain a NUL character');
  });

  it('prints one line for a NUL in --issued', () => {
    const result = runScriptWithArgv([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--issued',
      `credential-${String.fromCharCode(0)}-invalid`,
      '--reason',
      'ticket-1',
    ]);

    expectOneLineError(result, '--issued must not contain a NUL character');
  });

  it('prints one line for a NUL in --evidence', () => {
    const result = runScriptWithArgv([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--failed',
      '--evidence',
      `ticket-${String.fromCharCode(0)}-invalid`,
      '--reason',
      'ticket-1',
    ]);

    expectOneLineError(result, '--evidence must not contain a NUL character');
  });

  it('prints one line for a NUL in --reason', () => {
    const result = runScriptWithArgv([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      `ticket-${String.fromCharCode(0)}-invalid`,
    ]);

    expectOneLineError(result, '--reason must not contain a NUL character');
  });

  it('refuses --evidence with --issued without calling the operator', () => {
    // Regression: evidence supplied for issued resolution must not be silently discarded.
    const result = runScriptWithRepositoryMock([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--evidence',
      'ticket-1',
      '--reason',
      'ticket-1',
    ]);

    expectOneLineError(result, '--evidence applies only with --failed');
  });

  it('does not call the repository boundary for a blank --reason', () => {
    // Regression: a blank resolution reason must stop before repository work starts.
    const result = runScriptWithRepositoryMock([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      '',
    ]);

    expectOneLineError(result, '--reason is required');
  });

  it('does not call the repository boundary for blank --evidence', () => {
    // Regression: a blank evidence reference must stop before repository work starts too.
    const result = runScriptWithRepositoryMock([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--failed',
      '--evidence',
      '',
      '--reason',
      'ticket-1',
    ]);

    expectOneLineError(result, '--evidence is required');
  });

  it('reaches the repository mock for valid issued arguments', () => {
    // Regression: changing the operator repository module path or dropping its import must break this positive control.
    const result = runScriptWithRepositoryMockAndExpectSuccess([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '1',
      '--issued',
      'credential-1',
      '--reason',
      'ticket-1',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('repository mock was called\n');
  });

  it('passes failed resolution evidence through the script argument parser', () => {
    // Regression: --failed --evidence must reach the operator as a failed resolution instead of being dropped.
    const result = runScriptWithRepositoryMockAndCaptureOptions([
      'node',
      'script',
      '--tenant',
      'tenant-1',
      '--batch',
      'batch-1',
      '--index=0',
      '--version',
      '7',
      '--failed',
      '--evidence',
      'no credential was issued',
      '--reason',
      'INC-3',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      tenantId: 'tenant-1',
      batchId: 'batch-1',
      index: 0,
      expectedVersion: 7,
      resolution: { state: 'FAILED', evidence: 'no credential was issued' },
      reason: 'INC-3',
      dryRun: false,
    });
  });
});
