import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { guardExternalUrl } from './target';
import { startEphemeralPostgres, removeContainer } from './docker';

interface RigState {
  containerId: string | null;
}

/**
 * Jest globalSetup for the integration rig (#900; ADR-029 integration layer).
 *
 * Resolves exactly one owned database target, forces it onto
 * `RI_DATABASE_URL`, and applies migrations, all before any worker forks or
 * any module constructs a `PrismaClient`. Jest runs this in the parent
 * process and forks workers with a copy of `process.env`, so the assignment
 * is visible to every suite. Every downstream consumer of the database URL
 * (the generated client, `prisma.config.ts`, `seed.ts`) honours a pre-set
 * `RI_DATABASE_URL` and dotenv never overrides an existing value, so the
 * repository `.env`'s developer database cannot leak in.
 */
export default async function globalSetup(): Promise<void> {
  const external = process.env.TEST_DATABASE_URL;
  const state: RigState = { containerId: null };

  let url: string;
  if (external) {
    url = guardExternalUrl(external, process.env.TEST_DATABASE_ACCEPT_DESTRUCTIVE === 'true');
  } else {
    const ephemeral = startEphemeralPostgres();
    state.containerId = ephemeral.containerId;
    url = ephemeral.url;
  }

  process.env.RI_DATABASE_URL = url;
  (globalThis as Record<string, unknown>).__RI_INTEGRATION_RIG__ = state;

  // Jest 29 loads globalSetup through its script transformer (ts-jest here)
  // with static ESM disabled, so the module runs as CJS and __dirname exists.
  const packageRoot = path.resolve(__dirname, '../../..');
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--config', 'prisma/prisma.config.ts'], {
      cwd: packageRoot,
      env: { ...process.env, RI_DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim();
    if (state.containerId) {
      removeContainer(state.containerId);
      state.containerId = null;
    }
    throw new Error(`prisma migrate deploy failed against the rig database${stderr ? `:\n${stderr}` : ''}`, {
      cause: err,
    });
  }
}
