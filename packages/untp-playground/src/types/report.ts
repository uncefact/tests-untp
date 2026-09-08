import { SchemeType, TestCaseStatus, TestCaseStepId } from '../../constants';
import { EXTENSION_VERSIONS } from '../lib/schemaValidation';
import type { LinkSetSchemaStepDetails } from '../lib/linkSetValidation';
import type { LinkSetAssessment, LinkTypeCoverageStepDetails } from '../lib/linkTypeCoverage';
import { ArtefactSource, Credential, StoredCredential, StoredLinkSet, StoredScheme } from './credential';
import { TestStep } from './test';
import { PermittedCredentialType } from './untp';

/** One loaded credential instance and its pipeline result, as the report consumes it (ADR-041). */
export interface CredentialReportInput {
  credential: StoredCredential;
  steps: TestStep[];
}

/** One loaded scheme instance and its pipeline result, as the report consumes it (ADR-041). */
export interface SchemeReportInput {
  scheme: StoredScheme;
  steps: TestStep[];
}

/**
 * One loaded link set and the page's assessment of it (#814). The assessment is the same
 * projection the card and the tab indicator read (Schema Validation from the stored result,
 * Link Type Coverage derived from the URL bindings and credential instances), so the report
 * records what was on screen. `undefined` means the page has no assessment for the instance,
 * which blocks generation rather than being skipped.
 */
export interface LinkSetReportInput {
  linkSet: StoredLinkSet;
  assessment: Pick<LinkSetAssessment, 'steps' | 'overallStatus' | 'schemaRunning'> | undefined;
}

export interface TestReport {
  date: string;
  reportName: string;
  testSuite: {
    runner: string;
    version: string;
    url?: string;
  };
  implementation: {
    name: string;
  };
  pass: boolean;
  /** One entry per credential instance, in upload order. Always present; `[]` when none is loaded. */
  verifiableCredentials: TestReportResult[];
  /** One entry per conformity scheme instance, in upload order. Always present; `[]` when none is loaded. */
  conformitySchemes: TestReportSchemeResult[];
  /** One entry per link set, in upload order. Always present; `[]` when none is loaded. */
  linkSets: TestReportLinkSetResult[];
  playgroundUrl?: string;
}

export type TestReportStatus = Extract<
  TestCaseStatus,
  TestCaseStatus.SUCCESS | TestCaseStatus.WARNING | TestCaseStatus.FAILURE
>;

/** A settled credential or scheme step: the report never records one still running (ADR-041). Its details stay as the pipeline wrote them. */
export interface TestReportStep extends Omit<TestStep, 'status'> {
  status: TestReportStatus;
}

/** A link set's stored Schema Validation step, settled, with the attempt it records (#988). */
export interface TestReportLinkSetSchemaStep extends Omit<TestStep, 'id' | 'status' | 'details'> {
  id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION;
  status: TestReportStatus;
  details: LinkSetSchemaStepDetails;
}

/**
 * A link set's Link Type Coverage step (#1007). Coverage is derived from which linked credentials
 * the verifier has fetched so far, so it is the one report step allowed to be pending: "1 of 3
 * credential links checked" is a true record of the session, not a run cut short. This is the
 * explicit exception to ADR-041's terminal rule recorded for #814; it never changes the link set's
 * own status, while a coverage failure does.
 */
export interface TestReportCoverageStep extends Omit<TestStep, 'id' | 'status' | 'details'> {
  id: TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE;
  status: TestCaseStatus.SUCCESS | TestCaseStatus.FAILURE | TestCaseStatus.PENDING;
  details: LinkTypeCoverageStepDetails;
}

export interface TestReportResult {
  status: TestReportStatus;
  /** The card's title: the filename or a URL's final path segment, else the credential type. Never the raw URL. */
  title: string;
  credential: Credential;
  source?: ArtefactSource;
  core: {
    type: PermittedCredentialType;
    version: string;
    steps: TestReportStep[];
  };
  extension?: {
    type: keyof typeof EXTENSION_VERSIONS;
    version: string;
    steps: TestReportStep[];
  };
}

export interface TestReportSchemeResult {
  status: TestReportStatus;
  /** The card's title: the scheme's own name, else the source's final path segment or filename, else the family label. */
  title: string;
  type: SchemeType;
  version: string;
  /** The scheme document's own `name`, when it has one. Display falls back through `title`, never here. */
  name?: string;
  id?: string;
  source?: ArtefactSource;
  conformityScheme: Record<string, any>;
  steps: TestReportStep[];
}

export interface TestReportLinkSetResult {
  status: TestReportStatus;
  /** The card's title: the resolver URL without scheme or query, else the filename, else the first anchor, else `Link Set`. */
  title: string;
  /** The UNTP spec version the verifier had selected when the link set was added; the schema it was checked against. */
  validationVersion: string;
  source?: ArtefactSource;
  linkSet: Record<string, any>;
  /** Schema Validation, then Link Type Coverage, as the card lists them. */
  steps: [TestReportLinkSetSchemaStep, TestReportCoverageStep];
}

export enum DownloadReportFormat {
  HTML = 'html',
  JSON = 'json',
}
