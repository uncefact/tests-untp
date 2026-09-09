// Versioning metadata for the E2E HTML report: which version of the tested app ran,
// against which commit of the test suite, and when. Read by cypress.config.ts to name
// and label each run's report, and to write a companion run-info.json manifest.
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export interface ReportMeta {
  /** Version of the app under test (reference-implementation package.json, overridable for deployed targets). */
  appVersion: string;
  /** Short commit SHA of the checkout the test suite (and, for local Docker Compose runs, the app) was built from. */
  gitSha: string;
  /** True when the working tree was clean (no uncommitted changes) when the suite ran — an official report should only cite runs where this is true, since the tested code is otherwise not fully identified by gitSha alone. */
  officialRun: boolean;
  /** ISO timestamp of report generation. */
  generatedAt: string;
  /** Filesystem-safe identifier for this run's report directory, unique per run. */
  runId: string;
}

export interface ComponentVersion {
  image: string;
  state: string;
}

/**
 * Versions of the dependent services actually running for this suite (VCKit, storage service,
 * identity resolver, Keycloak, Postgres, ...), read from the live Docker Compose stack rather
 * than re-parsing docker-compose.e2e.yml's declared tags — so a locally overridden image tag is
 * still reported correctly. Only queried when baseUrl is local: for a deployed-instance run
 * there is no local stack to inspect, and querying it anyway risks reporting unrelated
 * containers left running from other work.
 */
export function getComponentVersions(
  repoRoot: string,
  composeFile: string,
  baseUrl: string,
): Record<string, ComponentVersion> {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) {
    return {};
  }

  try {
    const raw = execSync(`docker compose -f "${composeFile}" ps --format json`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();

    if (!raw) {
      return {};
    }

    // docker compose ps --format json emits either a JSON array or newline-delimited JSON
    // objects depending on the installed version — handle both.
    const containers = raw.startsWith('[') ? JSON.parse(raw) : raw.split('\n').map((line) => JSON.parse(line));

    return Object.fromEntries(
      containers.map((container: { Service: string; Image: string; State: string }) => [
        container.Service,
        { image: container.Image, state: container.State },
      ]),
    );
  } catch {
    return {};
  }
}

export function getReportMeta(e2eDir: string, appPackageJsonPath: string): ReportMeta {
  const appVersion =
    process.env.E2E_TESTED_APP_VERSION || (JSON.parse(fs.readFileSync(appPackageJsonPath, 'utf-8')).version as string);
  const gitSha = safeExec('git rev-parse --short HEAD', e2eDir);
  const officialRun = safeExec('git status --porcelain', e2eDir).length === 0;
  const generatedAt = new Date().toISOString();
  const timestamp = generatedAt.replace(/[:.]/g, '-');

  return {
    appVersion,
    gitSha,
    officialRun,
    generatedAt,
    runId: `${appVersion}_${gitSha}${officialRun ? '' : '-unofficial'}_${timestamp}`,
  };
}

/**
 * After the mochawesome HTML report has been generated for this run:
 * - writes a run-info.json manifest (versions + result totals) next to it,
 * - refreshes `latest.html` / `latest-run-info.json` at the reports root as a stable link,
 * - prunes old run directories beyond `keepRuns`, so the report history doesn't grow unbounded.
 */
export async function finalizeReport(
  reportsRoot: string,
  meta: ReportMeta,
  extra: Record<string, unknown>,
  keepRuns = 20,
): Promise<void> {
  const runDir = path.join(reportsRoot, meta.runId);

  try {
    await fs.promises.writeFile(path.join(runDir, 'run-info.json'), JSON.stringify({ ...meta, ...extra }, null, 2));

    await fs.promises.copyFile(path.join(runDir, 'index.html'), path.join(reportsRoot, 'latest.html'));
    await fs.promises.copyFile(path.join(runDir, 'run-info.json'), path.join(reportsRoot, 'latest-run-info.json'));

    const entries = await fs.promises.readdir(reportsRoot, { withFileTypes: true });
    const runDirs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const fullPath = path.join(reportsRoot, entry.name);
          const stat = await fs.promises.stat(fullPath);
          return { fullPath, mtime: stat.mtimeMs };
        }),
    );

    const stale = runDirs.sort((a, b) => b.mtime - a.mtime).slice(keepRuns);
    await Promise.all(stale.map((dir) => fs.promises.rm(dir.fullPath, { recursive: true, force: true })));
  } catch (error) {
    // Never let report bookkeeping fail the run — the timestamped report under runDir/ already exists.
    console.error('[reportMeta] Failed to finalize report metadata:', error);
  }
}
