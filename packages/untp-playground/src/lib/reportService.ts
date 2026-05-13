import { detectVersion } from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import { detectSchemeVersion } from '@/lib/schemeValidation';
import {
  StoredCredential,
  StoredScheme,
  TestReport,
  TestReportResult,
  TestReportSchemeResult,
  TestReportStep,
  TestStep,
} from '@/types';
import { reportName, testSuiteRunner, testSuiteUrl, testSuiteVersion } from '../../config';
import { CredentialType, SchemeType, TestCaseStatus, TestCaseStepId } from '../../constants';

interface GenerateReportParams {
  implementationName: string;
  credentials: Partial<Record<CredentialType, StoredCredential>>;
  testResults: Partial<Record<CredentialType, TestStep[]>>;
  schemes?: Partial<Record<SchemeType, StoredScheme>>;
  schemeTestResults?: Partial<Record<SchemeType, TestStep[]>>;
  passStatuses: TestCaseStatus[];
}

export const generateReport = async ({
  implementationName,
  credentials,
  testResults,
  schemes,
  schemeTestResults,
  passStatuses,
}: GenerateReportParams): Promise<TestReport> => {
  const validCredentials = Object.entries(credentials).map(
    ([type, cred]) => [type, cred] as [CredentialType, NonNullable<typeof cred>],
  );

  const results: TestReportResult[] = validCredentials.map(([type, credential]) => {
    const steps = testResults[type] || [];
    const extension = detectExtension(credential.decoded);
    const version = extension ? extension.core.version : detectVersion(credential.decoded);

    const coreSteps = steps.filter((step) => step.id !== TestCaseStepId.EXTENSION_SCHEMA_VALIDATION);
    const extensionStep = steps.find((step) => step.id === TestCaseStepId.EXTENSION_SCHEMA_VALIDATION);

    const status = steps.every((step) => passStatuses.includes(step.status))
      ? TestCaseStatus.SUCCESS
      : TestCaseStatus.FAILURE;
    const result: TestReportResult = {
      status,
      overallStatus: status,
      credential: credential.original,
      ...(credential.source && { source: credential.source }),
      core: {
        type,
        version,
        steps: coreSteps as TestReportStep[],
      },
    };

    if (extension && extensionStep) {
      result.extension = {
        type: extension.extension.type,
        version: extension.extension.version,
        steps: [extensionStep as TestReportStep],
      };
    }

    return result;
  });

  const validSchemes = Object.entries(schemes ?? {}).map(
    ([type, scheme]) => [type, scheme] as [SchemeType, NonNullable<typeof scheme>],
  );

  const schemeResults: TestReportSchemeResult[] = validSchemes.map(([type, scheme]) => {
    const steps = schemeTestResults?.[type] ?? [];
    const decoded = scheme.decoded;
    const version = detectSchemeVersion(decoded) ?? 'unknown';
    const name = typeof decoded?.name === 'string' ? decoded.name : undefined;
    const id = typeof decoded?.id === 'string' ? decoded.id : undefined;

    const status = steps.every((step) => passStatuses.includes(step.status))
      ? TestCaseStatus.SUCCESS
      : TestCaseStatus.FAILURE;
    return {
      status,
      overallStatus: status,
      type,
      version,
      ...(name && { name }),
      ...(id && { id }),
      ...(scheme.source && { source: scheme.source }),
      scheme: decoded,
      steps: steps as TestReportStep[],
    };
  });

  if (results.length === 0 && schemeResults.length === 0) {
    throw new Error('No valid credentials or schemes to generate report');
  }

  const allPass =
    results.every((result) => passStatuses.includes(result.status)) &&
    schemeResults.every((result) => passStatuses.includes(result.status));

  const playgroundUrl = process.env.NEXT_PUBLIC_PLAYGROUND_URL;

  return {
    date: new Date().toISOString(),
    reportName: reportName,
    testSuite: {
      runner: testSuiteRunner,
      version: testSuiteVersion,
      ...(testSuiteUrl && { url: testSuiteUrl }),
    },
    implementation: {
      name: implementationName,
    },
    pass: allPass,
    results,
    ...(schemeResults.length > 0 && { schemeResults }),
    ...(playgroundUrl && { playgroundUrl }),
  };
};
