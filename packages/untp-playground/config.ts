import packageJson from './package.json' assert { type: 'json' };

// Included within the test report
const testSuiteRunner = 'untp-playground';
const testSuiteVersion = packageJson.version || 'unknown';
const reportName = process.env.NEXT_PUBLIC_REPORT_NAME || 'UNTP';

export { testSuiteRunner, testSuiteVersion, reportName };
