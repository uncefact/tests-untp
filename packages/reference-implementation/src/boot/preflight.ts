import path from 'node:path';

import { describeBootError } from './describe-boot-error';
import { resolveBootProcessRole, runBootPreflight } from './boot-preflight';
import { formatWorkerBootFailure } from '../worker/format-boot-failure';

type StderrWriter = {
  write: (message: string, callback: (error?: Error | null) => void) => boolean;
};

export async function writeBootFailureAndExit(
  message: string,
  stderr: StderrWriter = process.stderr,
  exit: (code: number) => never = process.exit,
): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      stderr.write(message, () => resolve());
    } catch {
      resolve();
    }
  });
  exit(1);
}

let role: 'web' | 'worker' = 'web';

async function main(): Promise<void> {
  role = resolveBootProcessRole();
  await runBootPreflight(role);
}

const invokedScript = process.argv[1];
const isDirectInvocation =
  invokedScript !== undefined &&
  path.basename(invokedScript) === 'preflight.ts' &&
  path.basename(path.dirname(path.resolve(invokedScript))) === 'boot';

if (isDirectInvocation) {
  main().catch(async (error: unknown) => {
    const message = `${
      role === 'worker' ? formatWorkerBootFailure(error) : `Preflight failed: ${describeBootError(error)}`
    }\n`;
    await writeBootFailureAndExit(message);
  });
}
