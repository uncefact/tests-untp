jest.mock('./instrumentation.node', () => ({
  registerNode: jest.fn(async () => {
    throw new Error('configuration rejected');
  }),
}));
jest.mock('./lib/api/logger', () => {
  throw new Error('logger construction failed');
});
jest.mock('./lib/api/safe-error', () => ({ safeError: jest.fn() }));

import { register } from './instrumentation';

const originalRuntime = process.env.NEXT_RUNTIME;

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
});

it('writes the boot failure to stderr and exits when logger construction fails', async () => {
  process.env.NEXT_RUNTIME = 'nodejs';
  const stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  try {
    await expect(register()).resolves.toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledWith('Node instrumentation boot failed: configuration rejected');
    expect(exitSpy).toHaveBeenCalledWith(1);
  } finally {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  }
});
