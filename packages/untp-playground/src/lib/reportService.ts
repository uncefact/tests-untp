import { detectVersion } from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import { StoredCredential, TestReport, TestReportResult, TestReportStep, TestStep } from '@/types';
import { reportName, testSuiteRunner, testSuiteVersion } from '../../config';
import { CredentialType, TestCaseStatus, TestCaseStepId } from '../../constants';

interface GenerateReportParams {
  implementationName: string;
  credentials: Partial<Record<CredentialType, StoredCredential>>;
  testResults: Partial<Record<CredentialType, TestStep[]>>;
  passStatuses: TestCaseStatus[];
}

export const generateReport = async ({
  implementationName,
  credentials,
  testResults,
  passStatuses,
}: GenerateReportParams): Promise<TestReport> => {
  const validCredentials = Object.entries(credentials).map(
    ([type, cred]) => [type, cred] as [CredentialType, NonNullable<typeof cred>],
  );

  const results: TestReportResult[] = validCredentials.map(([type, credential]) => {
    const steps = testResults[type] || [];
    const extension = detectExtension(credential.decoded);
    // Get version from extension core if it exists, otherwise detect from credential
    const version = extension ? extension.core.version : detectVersion(credential.decoded);

    // Filter core steps (non-extension steps)
    const coreSteps = steps.filter((step) => step.id !== TestCaseStepId.EXTENSION_SCHEMA_VALIDATION);

    // Get extension step if it exists
    const extensionStep = steps.find((step) => step.id === TestCaseStepId.EXTENSION_SCHEMA_VALIDATION);

    const result: TestReportResult = {
      status: steps.every((step) => passStatuses.includes(step.status))
        ? TestCaseStatus.SUCCESS
        : TestCaseStatus.FAILURE,
      credential: credential.original,
      core: {
        type,
        version,
        steps: coreSteps as TestReportStep[],
      },
    };

    // Add extension data if it exists
    if (extension && extensionStep) {
      result.extension = {
        type: extension.extension.type,
        version: extension.extension.version,
        steps: [extensionStep as TestReportStep],
      };
    }

    return result;
  });

  if (results.length === 0) {
    throw new Error('No valid credentials to generate report');
  }

  return {
    date: new Date().toISOString(),
    reportName: reportName,
    testSuite: {
      runner: testSuiteRunner,
      version: testSuiteVersion,
    },
    implementation: {
      name: implementationName,
    },
    pass: results.every((result) => passStatuses.includes(result.status)),
    results,
  };
};
