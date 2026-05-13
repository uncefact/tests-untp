import packageJson from './package.json' assert { type: 'json' };

// Two distinct versions live here.
//
// `playgroundVersion` is the build version of THIS application (the UI).
// It is what the header chip in the playground itself displays. Env var:
// `NEXT_PUBLIC_PLAYGROUND_VERSION`. Falls back to the playground's own
// package.json so local dev "just works".
//
// `testSuiteRunner` / `testSuiteVersion` identify the code that actually
// executes the conformance checks recorded in the report. Today that code
// is bundled into the playground, so the version tracks the playground's
// package.json by default. When the suite is swapped out for the
// standalone `untp-test-suite` library, set `NEXT_PUBLIC_TEST_SUITE_VERSION`
// to that library's version so the report declares it accurately.
const playgroundVersion = process.env.NEXT_PUBLIC_PLAYGROUND_VERSION || packageJson.version || 'unknown';
const testSuiteRunner = 'untp-test-suite';
const testSuiteVersion = process.env.NEXT_PUBLIC_TEST_SUITE_VERSION || packageJson.version || 'unknown';
// Canonical home of the test runner. Surfaced as a link on the report's
// 'Test runner' line. Defaults to the runner's current home; override when
// the runner moves elsewhere (e.g. its own repository, an npm page, a
// project site). Not assumed to be a GitHub URL.
const testSuiteUrl = process.env.NEXT_PUBLIC_TEST_SUITE_URL || 'https://github.com/uncefact/tests-untp';
const reportName = process.env.NEXT_PUBLIC_REPORT_NAME || 'UNTP';

export { playgroundVersion, testSuiteRunner, testSuiteVersion, testSuiteUrl, reportName };
