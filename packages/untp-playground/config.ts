import packageJson from './package.json' assert { type: 'json' };

// Included within the test report
const testSuiteRunner = 'untp-playground';
const testSuiteVersion = packageJson.version || 'unknown';

export { testSuiteRunner, testSuiteVersion };
