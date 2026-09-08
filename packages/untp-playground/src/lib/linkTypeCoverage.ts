/**
 * Link Type Coverage (#1007): does each credential reached through a `dpp`, `dcc`, `dfr` or `dte`
 * link turn out to be that kind of credential?
 *
 * This is derived state, not a pipeline stage. Its inputs are the link set's rows, the page's URL
 * bindings and the credential instances those bindings point at, all of which change on the
 * Credentials tab, so the page derives one assessment per link set on every relevant change and
 * hands it to the card, the tab indicator and the report (#814). Nothing here is written
 * back into the link set's stored result: the stored result stays the schema step alone, because
 * two writers on one result race (the schema runner commits whole-list snapshots).
 */

import type { ArtefactSlot } from '@/types/artefact';
import type { StoredCredential, TestStep } from '@/types';
import { credentialGroupType, credentialIsTerminal, instanceStatus } from './credentialCollection';
import { detectCredentialType } from './credentialService';
import type { Credential } from '@/types';
import {
  occurrenceKey,
  type LinkedCredentialRow,
  type LinkOccurrence,
  type UntpCredentialRelation,
} from './linkSetCollection';
import { resolveBoundInstance, type UrlBindings } from './urlBindings';
import { TestCaseStatus, TestCaseStepId, UNTP_SHORT_CREDENTIAL_TYPES } from '../../constants';

export type RowCoverageOutcome =
  /** The row carries no UNTP credential relation, so it is not part of the check. */
  | { kind: 'excluded' }
  /** No settled, decrypted credential instance is bound to this href yet. */
  | { kind: 'pending'; expectedType: UntpCredentialRelation }
  | { kind: 'match'; expectedType: UntpCredentialRelation; detectedType: string }
  | { kind: 'mismatch'; expectedType: UntpCredentialRelation; detectedType: string };

export interface LinkTypeMismatch {
  /** Where the link sits; `occurrence.relation` is the relation as the link set spells it. */
  occurrence: LinkOccurrence;
  expectedType: UntpCredentialRelation;
  /**
   * The type the credentials pipeline detected, as the Credentials tab names it, or `Unknown` when
   * it recognised none. For a recognised extension (a Digital Livestock Passport) this is the
   * extension's own name; the comparison uses its core type, so such a link matches `dpp`.
   */
  detectedType: string;
  href: string;
}

/**
 * What the Link Type Coverage step stores in `details`: the counts and mismatches the card and
 * the report (#814) show. The summary below spreads this same object, so the two cannot drift.
 */
export interface LinkTypeCoverageStepDetails {
  /** Rows the card lists as credential links under a UNTP credential relation. */
  total: number;
  /** Of those, rows whose bound credential has settled and was compared. */
  checked: number;
  mismatches: readonly LinkTypeMismatch[];
  /** Present only when there was nothing to check. */
  note?: string;
}

export interface LinkTypeCoverage extends LinkTypeCoverageStepDetails {
  /**
   * Keyed by `occurrenceKey`, one entry per row passed in. The page passes credential rows only,
   * so `excluded` appears for media-type-only credential links; a caller passing every row would
   * also see it for non-credential links.
   */
  outcomes: ReadonlyMap<string, RowCoverageOutcome>;
  step: TestStep;
}

export const NO_RELATION_LINKS_NOTE = 'No UNTP-relation credential links to check.';

/** Narrows a step's untyped `details` back to the shape this module wrote, for a consumer that holds only the step, such as the report (#814). */
export function linkTypeCoverageStepDetails(step: TestStep): LinkTypeCoverageStepDetails | undefined {
  if (step.id !== TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE) return undefined;
  const details = step.details as Partial<LinkTypeCoverageStepDetails> | undefined;
  if (typeof details?.total !== 'number' || typeof details.checked !== 'number' || !Array.isArray(details.mismatches)) {
    return undefined;
  }
  return details as LinkTypeCoverageStepDetails;
}

/**
 * The coverage count line the card and the report (#814) both show: the note when there was
 * nothing to check, else `n of m credential link(s) checked.`
 */
export function coverageCountText(details: Pick<LinkTypeCoverageStepDetails, 'total' | 'checked' | 'note'>): string {
  if (details.total === 0) return details.note ?? NO_RELATION_LINKS_NOTE;
  return `${details.checked} of ${details.total} credential ${details.total === 1 ? 'link' : 'links'} checked.`;
}

/** The mismatch line the ticket asks for, e.g. `dcc link resolved to DigitalProductPassport`. */
export function mismatchText(mismatch: Pick<LinkTypeMismatch, 'expectedType' | 'detectedType'>): string {
  return `${mismatch.expectedType} link resolved to ${mismatch.detectedType}`;
}

type CredentialSlot = ArtefactSlot<StoredCredential, TestStep[]>;

export function deriveLinkTypeCoverage(
  rows: readonly LinkedCredentialRow[],
  urlBindings: UrlBindings,
  credentialItems: readonly CredentialSlot[],
): LinkTypeCoverage {
  const outcomes = new Map<string, RowCoverageOutcome>();
  const mismatches: LinkTypeMismatch[] = [];
  let total = 0;
  let checked = 0;

  for (const row of rows) {
    const key = occurrenceKey(row.occurrence);
    if (!row.expectedType) {
      outcomes.set(key, { kind: 'excluded' });
      continue;
    }
    total += 1;
    const instance = resolveBoundInstance(urlBindings, row.href, credentialItems);
    // A comparison needs a real credential that has finished its run: a locked envelope has no
    // type yet, and an unsettled run may still be replaced. A failed credential still has a
    // detected type and is compared; type match is not the same claim as validity.
    if (!instance || instance.payload.encryptedEnvelope || !credentialIsTerminal(instance.result ?? [])) {
      outcomes.set(key, { kind: 'pending', expectedType: row.expectedType });
      continue;
    }
    checked += 1;
    const coreType = credentialGroupType(instance.payload.decoded);
    const detectedType = detectCredentialType(instance.payload.decoded as Credential);
    // Unknown never matches: the pipeline rejects unknown types at ingest, but a future change
    // there must not silently turn into a pass here.
    const matches = UNTP_SHORT_CREDENTIAL_TYPES[coreType] === row.expectedType;
    if (matches) {
      outcomes.set(key, { kind: 'match', expectedType: row.expectedType, detectedType });
    } else {
      outcomes.set(key, { kind: 'mismatch', expectedType: row.expectedType, detectedType });
      mismatches.push({
        occurrence: row.occurrence,
        expectedType: row.expectedType,
        detectedType,
        href: row.href,
      });
    }
  }

  const status =
    mismatches.length > 0
      ? TestCaseStatus.FAILURE
      : checked === total
        ? TestCaseStatus.SUCCESS
        : TestCaseStatus.PENDING;

  const details: LinkTypeCoverageStepDetails = {
    total,
    checked,
    mismatches,
    ...(total === 0 ? { note: NO_RELATION_LINKS_NOTE } : {}),
  };
  const step: TestStep = { id: TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE, name: 'Link Type Coverage', status, details };

  return { ...details, outcomes, step };
}

export interface LinkSetAssessment {
  /** Schema Validation (stored) followed by Link Type Coverage (derived), in display order. */
  steps: readonly TestStep[];
  /**
   * The card's status: the schema roll-up, overridden to FAILURE by a coverage mismatch. Pending
   * coverage never changes it (#1007): a schema-valid link set with links still to verify is a
   * successful card with a visibly incomplete step, not a verifying one.
   */
  overallStatus: TestCaseStatus;
  /** Schema work unfinished (not started, pending or running); coverage never counts as activity. For #814's readiness rule. */
  schemaRunning: boolean;
  coverage: LinkTypeCoverage;
}

export function linkSetAssessment(schemaSteps: TestStep[] | undefined, coverage: LinkTypeCoverage): LinkSetAssessment {
  const schema = schemaSteps ?? [];
  const baseline = instanceStatus(schemaSteps);
  return {
    steps: [...schema, coverage.step],
    overallStatus: coverage.step.status === TestCaseStatus.FAILURE ? TestCaseStatus.FAILURE : baseline,
    schemaRunning:
      schema.length === 0 ||
      schema.some((step) => step.status === TestCaseStatus.PENDING || step.status === TestCaseStatus.IN_PROGRESS),
    coverage,
  };
}
