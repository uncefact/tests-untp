import { detectVersion } from '@/lib/credentialService';
import { credentialGroupType, credentialIsTerminal, credentialTitle } from '@/lib/credentialCollection';
import { linkSetTitle } from '@/lib/linkSetCollection';
import { linkSetSchemaStepDetails } from '@/lib/linkSetValidation';
import { linkTypeCoverageStepDetails } from '@/lib/linkTypeCoverage';
import { detectExtension } from '@/lib/schemaValidation';
import { schemeTitle } from '@/lib/schemeCollection';
import { detectSchemeVersion } from '@/lib/schemeValidation';
import {
  CredentialReportInput,
  LinkSetReportInput,
  PermittedCredentialType,
  SchemeReportInput,
  TestReport,
  TestReportCoverageStep,
  TestReportLinkSetResult,
  TestReportLinkSetSchemaStep,
  TestReportResult,
  TestReportSchemeResult,
  TestReportStatus,
  TestStep,
} from '@/types';
import { reportName, testSuiteRunner, testSuiteUrl, testSuiteVersion } from '../../config';
import { SchemeType, TestCaseStatus, TestCaseStepId } from '../../constants';

interface GenerateReportParams {
  implementationName: string;
  credentialInstances?: CredentialReportInput[];
  schemeInstances?: SchemeReportInput[];
  linkSetInstances?: LinkSetReportInput[];
  passStatuses: TestCaseStatus[];
}

const COVERAGE_STATUSES: ReadonlyArray<TestReportCoverageStep['status']> = [
  TestCaseStatus.SUCCESS,
  TestCaseStatus.FAILURE,
  TestCaseStatus.PENDING,
];

function isCoverageStatus(status: TestCaseStatus): status is TestReportCoverageStep['status'] {
  return (COVERAGE_STATUSES as ReadonlyArray<TestCaseStatus>).includes(status);
}

/**
 * Narrows a settled status for the report: the link set entry's status (the page's assessment,
 * terminal once the schema step is, #1007) and the schema step's own status. Both are already
 * terminal behind the `schemaRunning` guard, so a throw here is a contract break, not a user state.
 */
function reportStatus(status: TestCaseStatus, title: string): TestReportStatus {
  if (status === TestCaseStatus.SUCCESS || status === TestCaseStatus.WARNING || status === TestCaseStatus.FAILURE) {
    return status;
  }
  throw new Error(`Cannot record link set "${title}": its assessment is not settled (${status}).`);
}

/**
 * The report's link set entry (#814). The steps come from the page's assessment exactly as the
 * card shows them: Schema Validation (stored, terminal by the guard above) then Link Type
 * Coverage (derived, and allowed to be pending). Anything else is a contract break, not a user
 * state, so it throws with the link set's title rather than recording a partial entry.
 */
function projectLinkSet({ linkSet, assessment }: LinkSetReportInput): TestReportLinkSetResult {
  const title = linkSetTitle(linkSet);
  if (!assessment || assessment.schemaRunning) {
    throw new Error('Cannot generate a report while a link set is still validating.');
  }
  const [schemaStep, coverageStep, ...rest] = assessment.steps;
  if (rest.length > 0 || !schemaStep || !coverageStep) {
    throw new Error(`Cannot record link set "${title}": expected two steps, got ${assessment.steps.length}.`);
  }
  if (schemaStep.id !== TestCaseStepId.LINKSET_SCHEMA_VALIDATION) {
    throw new Error(`Cannot record link set "${title}": the first step is ${schemaStep.id}, not Schema Validation.`);
  }
  if (coverageStep.id !== TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE) {
    throw new Error(
      `Cannot record link set "${title}": the second step is ${coverageStep.id}, not Link Type Coverage.`,
    );
  }
  const schemaDetails = linkSetSchemaStepDetails(schemaStep);
  if (!schemaDetails) {
    throw new Error(`Cannot record link set "${title}": the Schema Validation step carries no attempt details.`);
  }
  const coverageDetails = linkTypeCoverageStepDetails(coverageStep);
  if (!coverageDetails || !isCoverageStatus(coverageStep.status)) {
    throw new Error(`Cannot record link set "${title}": the Link Type Coverage step is not readable.`);
  }
  const status = reportStatus(assessment.overallStatus, title);
  const schema: TestReportLinkSetSchemaStep = {
    id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
    name: schemaStep.name,
    status: reportStatus(schemaStep.status, title),
    details: schemaDetails,
  };
  // The accessor narrows the stored details; only its four fields are copied so the derived
  // coverage object's outcomes Map can never reach the JSON.
  const coverage: TestReportCoverageStep = {
    id: TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE,
    name: coverageStep.name,
    status: coverageStep.status,
    details: {
      total: coverageDetails.total,
      checked: coverageDetails.checked,
      mismatches: coverageDetails.mismatches,
      ...(coverageDetails.note !== undefined && { note: coverageDetails.note }),
    },
  };
  return {
    status,
    title,
    validationVersion: linkSet.validationVersion,
    ...(linkSet.source && { source: linkSet.source }),
    linkSet: linkSet.decoded,
    steps: [schema, coverage],
  };
}

export const generateReport = async ({
  implementationName,
  credentialInstances,
  schemeInstances,
  linkSetInstances,
  passStatuses,
}: GenerateReportParams): Promise<TestReport> => {
  // Defence in depth for the ADR-041 report-readiness gate: each projection below re-checks that
  // its instance is terminal (credentials and schemes) or that its schema step is (link sets), and
  // refuses rather than record a mid-pipeline artefact; the UI gate should already prevent this.
  const verifiableCredentials: TestReportResult[] = (credentialInstances ?? []).map(({ credential, steps }) => {
    if (!credentialIsTerminal(steps)) {
      throw new Error('Cannot generate a report while a credential is still validating.');
    }
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
      title: credentialTitle(credential),
      credential: credential.original,
      ...(credential.source && { source: credential.source }),
      core: {
        type,
        version,
        steps: coreSteps,
      },
    };

    if (extension && extensionStep) {
      result.extension = {
        type: extension.extension.type,
        version: extension.extension.version,
        steps: [extensionStep],
      };
    }

    return result;
  });

  const conformitySchemes: TestReportSchemeResult[] = (schemeInstances ?? []).map(({ scheme, steps }) => {
    if (!credentialIsTerminal(steps)) {
      throw new Error('Cannot generate a report while a scheme is still validating.');
    }
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
      title: schemeTitle(scheme),
      type: SchemeType.CONFORMITY_SCHEME,
      version,
      ...(name && { name }),
      ...(id && { id }),
      ...(scheme.source && { source: scheme.source }),
      conformityScheme: decoded,
      steps,
    };
  });

  const linkSets: TestReportLinkSetResult[] = (linkSetInstances ?? []).map(projectLinkSet);

  if (verifiableCredentials.length === 0 && conformitySchemes.length === 0 && linkSets.length === 0) {
    throw new Error('No credentials, conformity schemes or link sets to generate report.');
  }

  // `pass` reads each entry's own status. A link set's status already folds its steps the way
  // the card does (pending coverage leaves it unchanged); rolling its steps up again here would
  // turn a pending coverage step into an in-progress verdict.
  const allPass =
    verifiableCredentials.every((result) => passStatuses.includes(result.status)) &&
    conformitySchemes.every((result) => passStatuses.includes(result.status)) &&
    linkSets.every((result) => passStatuses.includes(result.status));

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
    verifiableCredentials,
    conformitySchemes,
    linkSets,
    ...(playgroundUrl && { playgroundUrl }),
  };
};
