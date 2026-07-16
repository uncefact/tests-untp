import { detectVersion } from '@/lib/credentialService';
import { credentialGroupType } from '@/lib/credentialCollection';
import { detectExtension } from '@/lib/schemaValidation';
import { detectSchemeVersion } from '@/lib/schemeValidation';
import {
  CredentialReportInput,
  PermittedCredentialType,
  SchemeReportInput,
  TestReport,
  TestReportResult,
  TestReportSchemeResult,
  TestReportStep,
  TestStep,
} from '@/types';
import { reportName, testSuiteRunner, testSuiteUrl, testSuiteVersion } from '../../config';
import { SchemeType, TERMINAL_STATUSES, TestCaseStatus, TestCaseStepId } from '../../constants';

interface GenerateReportParams {
  implementationName: string;
  credentialInstances?: CredentialReportInput[];
  schemeInstances?: SchemeReportInput[];
  passStatuses: TestCaseStatus[];
}

export const generateReport = async ({
  implementationName,
  credentialInstances,
  schemeInstances,
  passStatuses,
}: GenerateReportParams): Promise<TestReport> => {
  // Defence in depth for the ADR-041 report-readiness gate: every loaded artefact must be terminal
  // (a non-empty result whose steps have all settled). Refuse rather than record a mid-pipeline
  // artefact as a spurious pass or failure; the UI gate should already prevent reaching here.
  const isTerminal = (steps: TestStep[]) =>
    steps.length > 0 && steps.every((step) => TERMINAL_STATUSES.includes(step.status));

  for (const { steps } of credentialInstances ?? []) {
    if (!isTerminal(steps)) {
      throw new Error('Cannot generate a report while a credential is still validating.');
    }
  }
  for (const { steps } of schemeInstances ?? []) {
    if (!isTerminal(steps)) {
      throw new Error('Cannot generate a report while a scheme is still validating.');
    }
  }

  const results: TestReportResult[] = (credentialInstances ?? []).map(({ credential, steps }) => {
    const type = credentialGroupType(credential.decoded) as PermittedCredentialType;
    const extension = detectExtension(credential.decoded);
    const version = extension ? extension.core.version : detectVersion(credential.decoded);

    const coreSteps = steps.filter((step) => step.id !== TestCaseStepId.EXTENSION_SCHEMA_VALIDATION);
    const extensionStep = steps.find((step) => step.id === TestCaseStepId.EXTENSION_SCHEMA_VALIDATION);

    const status =
      steps.length > 0 && steps.every((step) => passStatuses.includes(step.status))
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

  const conformitySchemeResults: TestReportSchemeResult[] = (schemeInstances ?? []).map(({ scheme, steps }) => {
    const decoded = scheme.decoded;
    const version = detectSchemeVersion(decoded) ?? 'unknown';
    const name = typeof decoded?.name === 'string' ? decoded.name : undefined;
    const id = typeof decoded?.id === 'string' ? decoded.id : undefined;

    // An instance with no steps is not a clean pass: require at least one settled step.
    const status =
      steps.length > 0 && steps.every((step) => passStatuses.includes(step.status))
        ? TestCaseStatus.SUCCESS
        : TestCaseStatus.FAILURE;
    return {
      status,
      overallStatus: status,
      type: SchemeType.CONFORMITY_SCHEME,
      version,
      ...(name && { name }),
      ...(id && { id }),
      ...(scheme.source && { source: scheme.source }),
      conformityScheme: decoded,
      steps: steps as TestReportStep[],
    };
  });

  if (results.length === 0 && conformitySchemeResults.length === 0) {
    throw new Error('No valid credentials or schemes to generate report');
  }

  const allPass =
    results.every((result) => passStatuses.includes(result.status)) &&
    conformitySchemeResults.every((result) => passStatuses.includes(result.status));

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
    verifiableCredentials: results,
    ...(conformitySchemeResults.length > 0 && { conformitySchemeResults }),
    ...(playgroundUrl && { playgroundUrl }),
  };
};
