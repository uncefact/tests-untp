import path from 'path';
import { defineConfig } from 'cypress';
import { afterRunHook, beforeRunHook } from 'cypress-mochawesome-reporter/lib';
import { finalizeReport, getComponentVersions, getReportMeta } from './reportMeta';

const baseUrl = process.env.E2E_PLAYGROUND_BASE_URL || 'http://localhost:4000';

// Versions of the tested app and the test suite itself, embedded in the report's title,
// filename, and companion run-info.json — see reportMeta.ts.
const reportMeta = getReportMeta(__dirname, path.resolve(__dirname, '../package.json'));
// Reports write to cypress/reports by default; override with E2E_REPORTS_DIR (absolute, or
// relative to this e2e workspace's root) — e.g. to point CI at a shared/uploaded artifact path.
const reportsRoot = path.resolve(__dirname, process.env.E2E_REPORTS_DIR || 'cypress/reports');

// Versions of the dependent services actually running for this suite, plus the runtime that ran
// it — surfaced in the browser via Cypress.env(...) (see cypress/e2e/00-report-metadata.cy.ts)
// and written into run-info.json alongside reportMeta.
const repoRoot = path.resolve(__dirname, '../../..');
const composeFile = path.join(repoRoot, 'docker-compose.e2e.yml');
const componentVersions = getComponentVersions(repoRoot, composeFile, baseUrl);
const runtimeInfo = { node: process.version, packageManager: process.env.npm_config_user_agent || 'unknown' };

export default defineConfig({
  reporter: 'cypress-mochawesome-reporter',
  reporterOptions: {
    reportDir: path.join(reportsRoot, reportMeta.runId),
    // The report dir is unique per run (see reportMeta.ts), so there is nothing to overwrite —
    // this only guards against beforeRunHook wiping a same-second re-run.
    overwrite: false,
    charts: true,
    reportPageTitle: `UNTP Playground — E2E Report — app v${reportMeta.appVersion} — ${reportMeta.gitSha}${
      reportMeta.officialRun ? '' : ' (unofficial)'
    } — ${reportMeta.generatedAt}`,
    // Also write the full mochawesome JSON (all suites/tests, durations, error stacks) next to
    // index.html, as index.json — a machine-readable counterpart for scripts/CI, in addition to
    // the human-oriented HTML and the lightweight run-info.json summary written in finalizeReport.
    saveJson: true,
    embeddedScreenshots: true,
    inlineAssets: true,
    saveAllAttempts: false,
  },
  env: {
    PLAYGROUND_BASE_URL: baseUrl,

    // Report metadata, readable in-browser by cypress/e2e/00-report-metadata.cy.ts
    REPORT_META: reportMeta,
    COMPONENT_VERSIONS: componentVersions,
    RUNTIME_INFO: runtimeInfo,
  },
  e2e: {
    baseUrl,
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    video: false,
    screenshotsFolder: path.join(reportsRoot, reportMeta.runId, 'screenshots'),
    chromeWebSecurity: false,
    retries: {
      runMode: 2,
      openMode: 0,
    },
    defaultCommandTimeout: 10000,
    defaultBrowser: 'chrome',
    setupNodeEvents(on) {
      on('before:run', beforeRunHook);

      on('after:run', async (results) => {
        await afterRunHook(results);

        // Record what was actually tested (result totals + environment) alongside the report,
        // refresh the latest.html shortcut, and prune old run directories.
        const resultsSummary =
          'totalTests' in results
            ? {
                totalTests: results.totalTests,
                totalPassed: results.totalPassed,
                totalFailed: results.totalFailed,
                totalPending: results.totalPending,
                totalSkipped: results.totalSkipped,
                totalDuration: results.totalDuration,
                cypressVersion: results.cypressVersion,
                browserName: results.browserName,
                browserVersion: results.browserVersion,
                osName: results.osName,
                osVersion: results.osVersion,
              }
            : { status: 'failed' as const, message: results.message };

        await finalizeReport(reportsRoot, reportMeta, {
          baseUrl,
          components: componentVersions,
          runtime: runtimeInfo,
          results: resultsSummary,
        });
      });
    },
  },
});
