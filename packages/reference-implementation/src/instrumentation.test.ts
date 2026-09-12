const mockRegisterNode = jest.fn();
const mockApiLoggerError = jest.fn();
const mockSafeError = jest.fn((error: unknown) => ({
  name: error instanceof Error ? error.name : 'NonError',
  message: error instanceof Error ? error.message : String(error),
}));

jest.mock('./instrumentation.node', () => ({
  registerNode: (...args: unknown[]) => mockRegisterNode(...args),
}));
jest.mock('./lib/api/logger', () => ({ apiLogger: { error: (...args: unknown[]) => mockApiLoggerError(...args) } }));
jest.mock('./lib/api/safe-error', () => ({ safeError: (error: unknown) => mockSafeError(error) }));

import { register } from './instrumentation';

const originalRuntime = process.env.NEXT_RUNTIME;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_RUNTIME = 'nodejs';
  mockRegisterNode.mockReset();
  mockSafeError.mockImplementation((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonError',
    message: error instanceof Error ? error.message : String(error),
  }));
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
});

it('logs a refused Node boot with its message and code, then exits with code 1', async () => {
  const failure = Object.assign(new Error('configuration rejected'), { code: 'BOOT_CONFIGURATION_INVALID' });
  mockRegisterNode.mockRejectedValueOnce(failure);
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  await expect(register()).resolves.toBeUndefined();

  expect(mockApiLoggerError).toHaveBeenCalledWith(
    {
      error: { name: 'Error', message: 'configuration rejected' },
      code: 'BOOT_CONFIGURATION_INVALID',
    },
    'Node instrumentation boot failed',
  );
  expect(exitSpy).toHaveBeenCalledWith(1);

  exitSpy.mockRestore();
});

it('exits with code 1 even when reporting the refused boot throws', async () => {
  mockRegisterNode.mockRejectedValueOnce(new Error('configuration rejected'));
  mockApiLoggerError.mockImplementationOnce(() => {
    throw new Error('logger write failed');
  });
  const stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {
    throw new Error('stderr write failed');
  });
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  try {
    await expect(register()).rejects.toThrow('stderr write failed');
    // The regression this catches: a reporter exception escaped before the
    // boot refusal called process.exit(1).
    expect(exitSpy).toHaveBeenCalledWith(1);
  } finally {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  }
});

it('returns after a successful Node boot without exiting', async () => {
  mockRegisterNode.mockResolvedValueOnce(undefined);
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  try {
    await expect(register()).resolves.toBeUndefined();
    // The regression this catches: a success was reported as a boot refusal.
    expect(exitSpy).not.toHaveBeenCalled();
  } finally {
    exitSpy.mockRestore();
  }
});
