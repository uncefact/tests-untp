import packageJson from './package.json' assert { type: 'json' };

// Included within the test report. The runner is the library executing the
// tests (untp-test-suite), not the UI surfacing them (this playground).
const testSuiteRunner = 'untp-test-suite';
const testSuiteVersion = process.env.NEXT_PUBLIC_PLAYGROUND_VERSION || packageJson.version || 'unknown';
const reportName = process.env.NEXT_PUBLIC_REPORT_NAME || 'UNTP';

export { testSuiteRunner, testSuiteVersion, reportName };
