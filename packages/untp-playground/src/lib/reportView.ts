import { credentialTypeLabel } from '@/lib/credentialCollection';
import { linkSetSubtitle } from '@/lib/linkSetCollection';
import { schemaStepDialogErrors, schemaStepMessages } from '@/lib/linkSetValidation';
import { coverageCountText, mismatchText } from '@/lib/linkTypeCoverage';
import {
  buildValidationCards,
  validationCardsInDrawerOrder,
  type ValidationErrorCard,
} from '@/lib/validationErrorCards';
import type {
  TestReport,
  TestReportCoverageStep,
  TestReportLinkSetResult,
  TestReportLinkSetSchemaStep,
  TestReportResult,
  TestReportSchemeResult,
  TestReportStep,
} from '@/types';
import { permittedCredentialTypes } from '../../constants';

/**
 * What the HTML template renders (#814): the report plus presentation the JSON deliberately does
 * not carry. Credentials are grouped by type for the page's headings, and each link set carries
 * the same explanation as its card, without the card-only Verify hint. The JSON report stays
 * flat and raw (three family arrays, AJV errors and coverage details as recorded), so this view
 * is derived at download time and never written back.
 */
export interface TestReportView extends Omit<TestReport, 'linkSets'> {
  credentialGroups: CredentialGroupView[];
  linkSets: LinkSetView[];
}

type StepView = TestReportStep & { validationCards: ValidationErrorCard[] };
type CredentialResultView = Omit<TestReportResult, 'core' | 'extension'> & {
  core: Omit<TestReportResult['core'], 'steps'> & { steps: StepView[] };
  extension?: Omit<NonNullable<TestReportResult['extension']>, 'steps'> & { steps: StepView[] };
};
type SchemeResultView = Omit<TestReportSchemeResult, 'steps'> & { steps: StepView[] };

export interface CredentialGroupView {
  type: string;
  /** The spaced type name the Credentials tab shows, e.g. `Digital Product Passport`. */
  displayName: string;
  count: number;
  results: CredentialResultView[];
}

/** The link set entry for the template: the two steps carry their presentation, so the plain `steps` tuple is left out. */
export interface LinkSetView extends Omit<TestReportLinkSetResult, 'steps'> {
  /** `Link Set · v<version>`, the card's subtitle. */
  subtitle: string;
  /** The schema step with the card's explanation (minus its Verify hint), one line per error or one for a load failure. */
  schemaStep: TestReportLinkSetSchemaStep & { messages: string[]; validationCards: ValidationErrorCard[] };
  /** The coverage step with the count line the card shows and one line per mismatch. */
  coverageStep: TestReportCoverageStep & { countText: string; mismatchLines: Array<{ text: string; href: string }> };
}

/**
 * Groups credentials by their core type in the order of the Credentials tab's checklist (the
 * rule `TestResults.tsx` applies to its slots), keeping upload order within a group and skipping
 * empty groups. Types outside the checklist are unreachable today; if one ever arrived it would
 * follow in first-appearance order rather than vanish from the HTML.
 */
function groupCredentials(results: TestReportResult[]): CredentialGroupView[] {
  const permitted: string[] = [...permittedCredentialTypes];
  const others = results.map((result) => result.core.type as string).filter((type) => !permitted.includes(type));
  return [...permitted, ...new Set(others)]
    .map((type) => results.filter((result) => result.core.type === type))
    .filter((group) => group.length > 0)
    .map((group) => ({
      type: group[0].core.type,
      displayName: credentialTypeLabel(group[0].core.type),
      count: group.length,
      results: group.map(credentialResultView),
    }));
}

function stepView(step: TestReportStep, errors = step.details?.errors): StepView {
  return {
    ...step,
    validationCards: validationCardsInDrawerOrder(buildValidationCards(errors, step.failure)),
  };
}

function credentialResultView(result: TestReportResult): CredentialResultView {
  const { core, extension, ...rest } = result;
  return {
    ...rest,
    core: { ...core, steps: core.steps.map((step) => stepView(step)) },
    ...(extension ? { extension: { ...extension, steps: extension.steps.map((step) => stepView(step)) } } : {}),
  };
}

function schemeResultView(result: TestReportSchemeResult): SchemeResultView {
  return { ...result, steps: result.steps.map((step) => stepView(step)) };
}

function linkSetView(entry: TestReportLinkSetResult): LinkSetView {
  const { steps, ...rest } = entry;
  const [schemaStep, coverageStep] = steps;
  const schemaFailure = schemaStep.failure ?? schemaStep.details.failure;
  const schemaErrors =
    schemaStep.details.kind === 'document'
      ? schemaStepDialogErrors(schemaStep.details, entry.linkSet)
      : schemaStep.details.kind === 'schema-unusable' && schemaFailure
        ? schemaStep.details.errors ?? []
        : schemaStepMessages(schemaStep.details, entry.linkSet).map(({ text, relationRule }) => ({
            message: text,
            ...(relationRule ? { relationRule } : {}),
          }));
  return {
    ...rest,
    subtitle: linkSetSubtitle(entry),
    schemaStep: {
      ...schemaStep,
      messages: schemaStepMessages(schemaStep.details, entry.linkSet).map((message) => message.text),
      validationCards: validationCardsInDrawerOrder(buildValidationCards(schemaErrors, schemaFailure)),
    },
    coverageStep: {
      ...coverageStep,
      countText: coverageCountText(coverageStep.details),
      mismatchLines: coverageStep.details.mismatches.map((mismatch) => ({
        text: mismatchText(mismatch),
        href: mismatch.href,
      })),
    },
  };
}

/** Builds the template's view of a report without touching the report object itself. */
export function buildReportView(report: TestReport): TestReportView {
  return {
    ...report,
    credentialGroups: groupCredentials(report.verifiableCredentials),
    conformitySchemes: report.conformitySchemes.map(schemeResultView),
    linkSets: report.linkSets.map(linkSetView),
  };
}
