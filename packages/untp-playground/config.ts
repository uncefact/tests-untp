import packageJson from './package.json' assert { type: 'json' };

// Included within the test report
const testSuiteRunner = 'untp-playground';
const testSuiteVersion = packageJson.version || 'unknown';
const reportName = process.env.NEXT_PUBLIC_REPORT_NAME || 'UNTP';

// VC Verification Service
const verificationServiceUrl = process.env.NEXT_PUBLIC_VERIFICATION_SERVICE_URL || 'https://vckit.untp.showthething.com/agent/routeVerificationCredential';
const verificationServiceToken = process.env.NEXT_PUBLIC_VERIFICATION_SERVICE_TOKEN || 'test123';

export { testSuiteRunner, testSuiteVersion, reportName, verificationServiceUrl, verificationServiceToken };
