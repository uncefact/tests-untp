import { execFileSync } from 'node:child_process';

/**
 * Ephemeral Postgres lifecycle for the integration rig, via the docker CLI.
 *
 * One container per jest run: `postgres:17-alpine` (the same pin as the
 * repository's `ri-db` and `e2e-ri-db` services) on a docker-assigned
 * loopback port. Containers carry a label so an orphan left by a crashed
 * run is identified and removed by the next run rather than accumulating.
 */

const IMAGE = 'postgres:17-alpine';
const LABEL = 'untp-ri-integration-rig=true';
export const EPHEMERAL_DB_NAME = 'ri_integration';
const DB_USER = 'test';
const DB_PASSWORD = 'test';
const READINESS_TIMEOUT_MS = 60_000;
const READINESS_POLL_MS = 250;

function docker(args: string[]): string {
  try {
    return execFileSync('docker', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim();
    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed${stderr ? `: ${stderr}` : ''}`, { cause: err });
  }
}

function assertDockerAvailable(): void {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'The integration rig needs a running docker daemon to start its ephemeral Postgres container ' +
        '(or set TEST_DATABASE_URL to an existing dedicated test database). Docker is not reachable.',
    );
  }
}

/**
 * Removes containers left behind by a previous crashed run. The label is
 * shared by every rig container, so this assumes one rig per docker daemon:
 * two simultaneous local `test:integration` runs would remove each other's
 * database. CI runners are isolated; locally, run one at a time.
 */
function removeOrphans(): void {
  const orphans = docker(['ps', '-aq', '--filter', `label=${LABEL}`]);
  for (const id of orphans.split('\n').filter(Boolean)) {
    docker(['rm', '-f', id]);
  }
}

function mappedHostPort(containerId: string): string {
  // `docker port` may print IPv4 and IPv6 mappings; take the IPv4 line.
  const lines = docker(['port', containerId, '5432/tcp']).split('\n');
  const ipv4 = lines.find((l) => l.startsWith('127.0.0.1:')) ?? lines[0];
  const port = ipv4?.split(':').pop();
  if (!port || !/^\d+$/.test(port)) {
    throw new Error(
      `Could not determine the ephemeral container's mapped port (docker port said: "${lines.join(' | ')}")`,
    );
  }
  return port;
}

function waitForReadiness(containerId: string): void {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  // The official postgres image restarts the server once during first-boot
  // init, and pg_isready can succeed against the throwaway init server, so
  // readiness requires two consecutive successful probes.
  let consecutive = 0;
  while (Date.now() < deadline) {
    try {
      execFileSync('docker', ['exec', containerId, 'pg_isready', '-U', DB_USER, '-d', EPHEMERAL_DB_NAME], {
        stdio: 'ignore',
      });
      consecutive += 1;
      if (consecutive >= 2) return;
    } catch {
      consecutive = 0;
      // "Not ready yet" and "the container died" both land here; only the
      // former is worth waiting out, so a non-running container fails now
      // with its logs rather than burning the timeout on a lost cause.
      let state = 'unknown';
      try {
        state = docker(['inspect', '-f', '{{.State.Status}}', containerId]);
      } catch {
        throw new Error(
          `Ephemeral Postgres container disappeared (or the docker daemon stopped) while waiting for readiness.`,
        );
      }
      if (state !== 'running' && state !== 'created') {
        const logs = docker(['logs', '--tail', '20', containerId]);
        docker(['rm', '-f', containerId]);
        throw new Error(`Ephemeral Postgres container is "${state}" instead of running. Last container logs:\n${logs}`);
      }
    }
    execFileSync('sleep', [String(READINESS_POLL_MS / 1000)]);
  }
  const logs = docker(['logs', '--tail', '20', containerId]);
  docker(['rm', '-f', containerId]);
  throw new Error(
    `Ephemeral Postgres did not become ready within ${READINESS_TIMEOUT_MS / 1000}s. Last container logs:\n${logs}`,
  );
}

export interface EphemeralPostgres {
  containerId: string;
  url: string;
}

export function startEphemeralPostgres(): EphemeralPostgres {
  assertDockerAvailable();
  removeOrphans();
  const containerId = docker([
    'run',
    '-d',
    '--label',
    LABEL,
    '-e',
    `POSTGRES_USER=${DB_USER}`,
    '-e',
    `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    '-e',
    `POSTGRES_DB=${EPHEMERAL_DB_NAME}`,
    '-p',
    // Port 0 lets docker pick a free host port atomically (no preselect race).
    '127.0.0.1:0:5432',
    IMAGE,
  ]);
  try {
    const port = mappedHostPort(containerId);
    waitForReadiness(containerId);
    return {
      containerId,
      url: `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${port}/${EPHEMERAL_DB_NAME}`,
    };
  } catch (err) {
    // Best-effort cleanup for the paths that have not already removed the
    // container (waitForReadiness removes it itself). A failing `rm -f` is
    // swallowed so the original startup error surfaces; a leaked container
    // is picked up by the next run's label-based orphan removal.
    try {
      docker(['rm', '-f', containerId]);
    } catch {
      /* orphan removal on the next run is the backstop */
    }
    throw err;
  }
}

export function removeContainer(containerId: string): void {
  docker(['rm', '-f', containerId]);
}
