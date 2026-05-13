import packageJson from './package.json' assert { type: 'json' };

// Two distinct versions live here.
//
// `playgroundVersion` is the build version of THIS application (the UI).
// It is what the header chip in the playground itself displays. Env var:
// `NEXT_PUBLIC_PLAYGROUND_VERSION`. Falls back to the playground's own
// package.json so local dev "just works".
//
// `testSuiteVersion` is the version of the conformance test library
// that produced the report. It is what the report's "Test runner" line
// shows. Today the playground bundles its validation logic, so the
// default tracks the playground's package.json; once the suite is
// extracted to its own npm package, deployments can pin this independently
// via `NEXT_PUBLIC_TEST_SUITE_VERSION` without affecting the UI header.
const playgroundVersion = process.env.NEXT_PUBLIC_PLAYGROUND_VERSION || packageJson.version || 'unknown';
const testSuiteRunner = 'untp-test-suite';
const testSuiteVersion = process.env.NEXT_PUBLIC_TEST_SUITE_VERSION || packageJson.version || 'unknown';
const reportName = process.env.NEXT_PUBLIC_REPORT_NAME || 'UNTP';

export { playgroundVersion, testSuiteRunner, testSuiteVersion, reportName };
