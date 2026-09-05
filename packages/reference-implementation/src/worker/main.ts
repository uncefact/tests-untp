/**
 * The background worker's entrypoint (#985; ADR-054). Run as
 * `node --import tsx src/worker/main.ts` so this process is PID 1 and gets
 * the container's signals itself.
 *
 * Only telemetry is imported statically: the auto-instrumentation patches
 * `pg`, `pino` and HTTP as the module system loads them, so the SDK starts
 * before the dynamic import below pulls in the handler graph. The web boot
 * does not do this and gets no such spans; that is its own change.
 *
 * In the checkout the repository root `.env` is loaded the way
 * `next.config.ts` loads it for the web, so `pnpm worker` targets the same
 * database as `pnpm start`. In the image the file does not exist and dotenv
 * skips it; compose supplies the environment, and dotenv never overrides a
 * value that is already set.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveServiceName } from '../lib/observability/resource';
import { startNodeSdk } from '../lib/observability/start-sdk';
import { readReferenceImplementationVersion } from './version';
import { defaultMigrationsDir } from './schema-readiness';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../../.env') });

const DEFAULT_WORKER_SERVICE_NAME = 'reference-implementation-worker';

async function main(): Promise<void> {
  const serviceName = resolveServiceName(process.env.OTEL_SERVICE_NAME?.trim() || DEFAULT_WORKER_SERVICE_NAME);
  const version = readReferenceImplementationVersion(here);
  if ('reason' in version) {
    // Telemetry attribute only; not worth refusing to work over. The logger
    // is not up yet (it is part of the graph telemetry must precede).
    // eslint-disable-next-line no-console
    console.warn(`Worker version unresolved, reporting "unknown": ${version.reason}`);
  }
  const serviceVersion = 'version' in version ? version.version : 'unknown';
  const sdk = startNodeSdk({ serviceName, serviceVersion });
  const { runWorker } = await import('./bootstrap');
  await runWorker({ sdk, migrationsDir: defaultMigrationsDir(here) });
}

main().catch((error: unknown) => {
  // The logger may be the thing that failed (an invalid LOG_REDACT_PATHS
  // throws when it is constructed), so the boot failure goes to stderr, with
  // the cause chain: the same named failure can have different fixes (a
  // migrations directory that is missing versus one the user cannot read).
  // eslint-disable-next-line no-console
  console.error(`Worker boot failed: ${describe(error)}`);
  process.exit(1);
});

function describe(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return String(error);
  const code = 'code' in error && error.code !== undefined ? ` [${String(error.code)}]` : '';
  const cause = error.cause !== undefined && depth < 4 ? `\n  caused by: ${describe(error.cause, depth + 1)}` : '';
  return `${error.message}${code}${cause}`;
}
