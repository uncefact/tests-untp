'use client';

import { SourceCaption } from '@/components/SourceCaption';
import { StatusIcon } from '@/components/StatusIcon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { beginRun, commitResult, remove, restore } from '@/lib/artefactCollection';
import {
  linkedCredentialRows,
  linkSetKey,
  linkSetSubtitle,
  linkSetTitle,
  occurrenceKey,
} from '@/lib/linkSetCollection';
import {
  coverageCountText,
  mismatchText,
  type LinkSetAssessment,
  type RowCoverageOutcome,
} from '@/lib/linkTypeCoverage';

import {
  linkSetSchemaStepDetails,
  linkSetSchemaUrl,
  linkSetValidationSteps,
  schemaStepMessages,
  toLinkSetSchemaStepDetails,
  validateLinkSetSchema,
  type LinkSetSchemaStepDetails,
} from '@/lib/linkSetValidation';
import { credentialIsTerminal, instanceStatus } from '@/lib/credentialCollection';
import { newId } from '@/lib/id';
import { fetchLinkedCredential } from '@/lib/fetchLinkedCredential';
import { resolveBoundInstance, type UrlBindings } from '@/lib/urlBindings';
import type { LinkedCredentialRow } from '@/lib/linkSetCollection';
import type { ArtefactSlot, CollectionState, InstanceId, RunId } from '@/types/artefact';
import type { ArtefactSource, StoredCredential, StoredLinkSet, TestStep } from '@/types';
import { ChevronDown, ChevronRight, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CREDENTIAL_LINKS_DOCS_URL,
  LINK_SET_VALIDATION_DOCS_URL,
  TERMINAL_STATUSES,
  TestCaseStatus,
  TestCaseStepId,
} from '../../constants';

type LinkSetCollection = CollectionState<StoredLinkSet, TestStep[]>;
type LinkSetDispatch = <Res extends { state: LinkSetCollection }>(
  transition: (current: LinkSetCollection) => Res,
) => Res;
type LinkSetSlot = ArtefactSlot<StoredLinkSet, TestStep[]>;

type CredentialSlot = ArtefactSlot<StoredCredential, TestStep[]>;

interface LinkSetTestResultsProps {
  collection: LinkSetCollection;
  dispatch: LinkSetDispatch;
  /** Credentials-tab instances, read-only: each linked row derives its state from them (#812). */
  credentialItems: CredentialSlot[];
  /** Which instance each URL's latest accepted ingestion produced (page-owned; see urlBindings.ts). */
  urlBindings: UrlBindings;
  /**
   * One assessment per link set instance (#1007): the stored schema step plus the derived Link
   * Type Coverage step and the card status, computed by the page from the same inputs the tab
   * indicator reads (and the report will, #814). The card renders it and never re-derives
   * (linkTypeCoverage.ts).
   */
  assessments: ReadonlyMap<InstanceId, LinkSetAssessment>;
  /** Marks the start of a Verify attempt on the page's attempt clock (#1007). */
  beginUrlAttempt: () => number;
  /**
   * A Verify of this href produced no accepted credential (#1007). The page forgets the href's
   * binding unless it was bound again after `startedAt`, so a previous result cannot stand in
   * for content that is no longer there and a slow failure cannot erase a newer success.
   */
  onVerifyRejected: (urls: Array<string | undefined>, startedAt: number) => void;
  /**
   * Routes a fetched linked credential into the credentials pipeline (page.tsx owns ingestion).
   * Returns the outcome; a rejection has already been dispatched to the error surface, so the row
   * only gates its own feedback on it.
   */
  onVerifyCredential: (
    rawArtefact: unknown,
    source: ArtefactSource,
  ) => { accepted: false } | { accepted: true; instanceId: string; encrypted?: true; alreadyDecrypted?: true };
  /**
   * Resolves a secondary identity resolver link as a new link set card (#974): the same flow as
   * submitting the URL through the resolve input, owned by the page so identity and replace
   * semantics stay ADR-046's.
   */
  onResolveSecondary: (href: string) => Promise<void>;
}

export function LinkSetTestResults({
  collection,
  dispatch,
  credentialItems,
  urlBindings,
  assessments,
  onVerifyCredential,
  beginUrlAttempt,
  onVerifyRejected,
  onResolveSecondary,
}: LinkSetTestResultsProps) {
  // In-flight fetches live at the list level, keyed by operation plus href ("verify:<href>" /
  // "resolve:<href>"), so collapsing a card (which unmounts its rows) cannot lose the flag, a
  // second overlapping fetch of the same target is prevented, and a Verify and a Resolve of one
  // href cannot cross-lock each other (they are different operations with different Accept
  // profiles).
  const [fetchingHrefs, setFetchingHrefs] = useState<ReadonlySet<string>>(new Set());
  // Fallback encrypted signal (#812): resolvers do not always carry the Secure Targets metadata,
  // so a Verify that fetches an encrypted envelope records the discovery here and the row keeps
  // its Encrypted tag from then on. List-level for the same unmount reason as fetchingHrefs.
  const [discoveredEncryptedHrefs, setDiscoveredEncryptedHrefs] = useState<ReadonlySet<string>>(new Set());
  // Discovery is empirical, so it follows the evidence in both directions: an accepted plaintext
  // ingest clears the discovery, or a settled row could show Verified beside a stale Encrypted tag.
  const setDiscoveredEncrypted = (href: string, discovered: boolean) =>
    setDiscoveredEncryptedHrefs((current) => {
      if (current.has(href) === discovered) return current;
      const next = new Set(current);
      if (discovered) next.add(href);
      else next.delete(href);
      return next;
    });
  const setHrefFetching = (href: string, fetching: boolean) => {
    setFetchingHrefs((current) => {
      const next = new Set(current);
      if (fetching) next.add(href);
      else next.delete(href);
      return next;
    });
  };
  // Start the pipeline for any instance that has no live run and no result yet (freshly added,
  // replaced, or restored idle by Undo). beginRun no-ops on an already-running slot, so a repeated
  // effect cannot double-start.
  useEffect(() => {
    for (const item of collection.items) {
      if (item.runId === null && item.result === undefined) {
        const { runId } = dispatch((state) => beginRun(state, item.instanceId, linkSetValidationSteps(), newId));
        if (runId) void runLinkSetPipeline(item.instanceId, runId, item.payload, dispatch);
      }
    }
  }, [collection.items, dispatch]);

  // Remove is a single-level undo (#811): no confirm dialog, a toast with Undo restores the slot
  // at its old position. restore() no-ops when the same link set was re-added before undoing.
  const handleRemove = (item: LinkSetSlot) => {
    const index = collection.items.findIndex((candidate) => candidate.instanceId === item.instanceId);
    // What Undo puts back (#988, ADR-047 update): a settled result is restored intact, but a run
    // still in flight is restored idle. Once the slot is removed, the run's later commits are
    // rejected by the run guard, so restoring its token would leave the card spinning forever;
    // an idle slot makes the begin-run effect start a fresh run instead. The captured version
    // travels with the payload, so the restart validates against the same schema.
    const snapshot: LinkSetSlot = credentialIsTerminal(item.result ?? [])
      ? item
      : { ...item, runId: null, result: undefined };
    dispatch((state) => remove(state, item.instanceId));
    // A stable toast id makes a newer removal replace the previous toast, enforcing ADR-047's
    // single-level undo instead of stacking several live Undo actions.
    toast.success(`Removed ${linkSetTitle(item.payload)}`, {
      id: 'linkset-remove-undo',
      action: {
        label: 'Undo',
        onClick: () => {
          const { restored } = dispatch((state) => restore(state, snapshot, index));
          if (!restored) {
            // restore() no-ops when the same link set was re-added before the undo; say so rather
            // than letting a user-initiated action appear to do nothing.
            toast.info(`${linkSetTitle(item.payload)} is already back in the list.`);
          }
        },
      },
    });
  };

  return (
    <section className='space-y-4' data-testid='linkset-results'>
      {collection.items.map((item) => (
        <LinkSetCard
          key={item.instanceId}
          item={item}
          onRemove={() => handleRemove(item)}
          assessment={assessments.get(item.instanceId)}
          credentialItems={credentialItems}
          urlBindings={urlBindings}
          onVerifyCredential={onVerifyCredential}
          beginUrlAttempt={beginUrlAttempt}
          onVerifyRejected={onVerifyRejected}
          onResolveSecondary={onResolveSecondary}
          fetchingHrefs={fetchingHrefs}
          setHrefFetching={setHrefFetching}
          discoveredEncryptedHrefs={discoveredEncryptedHrefs}
          setDiscoveredEncrypted={setDiscoveredEncrypted}
        />
      ))}
    </section>
  );
}

/**
 * Runs the link set pipeline for one instance. Mirrors runSchemePipeline: the only write path is
 * `setStep`, which commits the whole step list through the run guard and reports false once the
 * run has been superseded (replaced, removed) so a stale run stops writing. Every throw settles
 * the step; a link set never sits IN_PROGRESS because something unexpected escaped.
 */
async function runLinkSetPipeline(
  instanceId: InstanceId,
  runId: RunId,
  stored: StoredLinkSet,
  dispatch: LinkSetDispatch,
): Promise<void> {
  const steps = linkSetValidationSteps();
  const setStep = (stepId: TestCaseStepId, patch: Partial<TestStep>): boolean => {
    const index = steps.findIndex((step) => step.id === stepId);
    if (index !== -1) steps[index] = { ...steps[index], ...patch };
    const { applied } = dispatch((state) =>
      commitResult(state, { instanceId, runId, result: steps.map((step) => ({ ...step })) }),
    );
    return applied;
  };

  if (!setStep(TestCaseStepId.LINKSET_SCHEMA_VALIDATION, { status: TestCaseStatus.IN_PROGRESS })) return;
  try {
    const result = await validateLinkSetSchema(stored.decoded, stored.validationVersion);
    const details = toLinkSetSchemaStepDetails(result);
    setStep(TestCaseStepId.LINKSET_SCHEMA_VALIDATION, {
      status: result.kind === 'document' && result.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
      details,
    });
  } catch (err) {
    // Only a bug reaches here (the validator settles every expected failure into a result), so
    // the log carries what an operator needs to find it, and the card still names the URL.
    const schemaUrl = linkSetSchemaUrl(stored.validationVersion);
    console.error('runLinkSetPipeline: schema validation threw', {
      instanceId,
      version: stored.validationVersion,
      schemaUrl,
      err,
    });
    setStep(TestCaseStepId.LINKSET_SCHEMA_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: {
        kind: 'schema-unusable',
        version: stored.validationVersion,
        schemaUrl,
        message: err instanceof Error ? err.message : 'Schema validation failed for an unknown reason.',
      } satisfies LinkSetSchemaStepDetails,
    });
  }
}

/** The card's relation-rule message ends with what the verifier can still do here; the report omits it. */
const VERIFY_HINT = ' Any credential links listed on this card can still be verified.';

function LinkSetCard({
  item,
  onRemove,
  assessment,
  credentialItems,
  urlBindings,
  onVerifyCredential,
  beginUrlAttempt,
  onVerifyRejected,
  onResolveSecondary,
  fetchingHrefs,
  setHrefFetching,
  discoveredEncryptedHrefs,
  setDiscoveredEncrypted,
}: {
  item: LinkSetSlot;
  onRemove: () => void;
  assessment: LinkSetAssessment | undefined;
  credentialItems: CredentialSlot[];
  urlBindings: UrlBindings;
  onVerifyCredential: (
    rawArtefact: unknown,
    source: ArtefactSource,
  ) => { accepted: false } | { accepted: true; instanceId: string; encrypted?: true; alreadyDecrypted?: true };
  beginUrlAttempt: () => number;
  onVerifyRejected: (urls: Array<string | undefined>, startedAt: number) => void;
  onResolveSecondary: (href: string) => Promise<void>;
  fetchingHrefs: ReadonlySet<string>;
  setHrefFetching: (href: string, fetching: boolean) => void;
  discoveredEncryptedHrefs: ReadonlySet<string>;
  setDiscoveredEncrypted: (href: string, discovered: boolean) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const linkSet = item.payload;
  // The page supplies the composed steps and status; a caller that supplies no assessment for this
  // instance gets the stored schema steps alone.
  const steps = assessment?.steps ?? item.result ?? [];
  const title = linkSetTitle(linkSet);
  const allRows = linkedCredentialRows(linkSet.decoded);
  // Split by the UNTP Identity Resolver spec's credential-link rule (relation dpp/dcc/dfr/dte or
  // a verifiable-credential media type). Other links are counted, not listed: the playground
  // validates credentials, and the docs page explains how the split is decided.
  const credentialRows = allRows.filter((row) => row.credential);
  // Secondary resolvers are listed with their own Resolve action (#974), so they are neither
  // credential rows nor part of the unlisted other-links count.
  const secondaryRows = allRows.filter((row) => row.secondary);
  const otherLinkCount = allRows.length - credentialRows.length - secondaryRows.length;

  // Schema roll-up, overridden by a coverage mismatch; pending coverage never spins (#1007).
  const overallStatus = assessment?.overallStatus ?? instanceStatus(item.result);
  const rowOutcome = (row: LinkedCredentialRow): RowCoverageOutcome | undefined =>
    assessment?.coverage.outcomes.get(occurrenceKey(row.occurrence));

  return (
    <Card className='group relative overflow-hidden p-4'>
      <div
        className='flex flex-wrap items-center justify-between gap-2 cursor-pointer'
        onClick={() => setIsExpanded((prev) => !prev)}
        data-testid='linkset-card-header'
        data-instance-id={item.instanceId}
      >
        <div className='flex min-w-0 items-center gap-2'>
          {isExpanded ? <ChevronDown className='h-4 w-4 shrink-0' /> : <ChevronRight className='h-4 w-4 shrink-0' />}
          <div className='flex min-w-0 flex-col'>
            <h3 className='truncate font-semibold'>{title}</h3>
            <span className='truncate text-xs text-gray-500' data-testid='linkset-subtitle'>
              {linkSetSubtitle(linkSet)}
            </span>
          </div>
        </div>
        <StatusIcon status={overallStatus} testId={item.instanceId} />
      </div>
      {isExpanded && (
        <div className='mt-4 space-y-2 pl-6'>
          {linkSet.source && <SourceCaption source={linkSet.source} />}
          {steps.map((step) => (
            <div key={step.id} className='py-2'>
              <div className='flex items-center gap-2'>
                <StatusIcon status={step.status} testId={step.id} />
                <span>{step.name}</span>
              </div>
              {step.id === TestCaseStepId.LINKSET_SCHEMA_VALIDATION &&
                step.status === TestCaseStatus.FAILURE &&
                step.details && (
                  <ul
                    className='mt-1 list-disc space-y-1 pl-6 text-sm text-red-600'
                    data-testid='linkset-schema-errors'
                  >
                    {schemaStepMessages(linkSetSchemaStepDetails(step), linkSet.decoded).map((message, idx) => (
                      <li key={idx} data-relation-rule={message.relationRule ? 'true' : undefined}>
                        {message.relationRule ? `${message.text}${VERIFY_HINT}` : message.text}
                      </li>
                    ))}
                  </ul>
                )}
              {step.id === TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE && assessment && (
                <div className='mt-1 pl-6 text-sm' data-testid='linkset-coverage'>
                  <p className='text-muted-foreground' data-testid='linkset-coverage-count'>
                    {coverageCountText(assessment.coverage)}
                  </p>
                  {assessment.coverage.mismatches.length > 0 && (
                    <ul
                      className='mt-1 list-disc space-y-1 pl-6 text-red-600'
                      data-testid='linkset-coverage-mismatches'
                    >
                      {assessment.coverage.mismatches.map((mismatch) => (
                        <li key={occurrenceKey(mismatch.occurrence)}>
                          {mismatchText(mismatch)}{' '}
                          <span className='break-all font-mono text-xs text-muted-foreground'>{mismatch.href}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
          <p className='text-xs text-muted-foreground'>
            <a
              href={LINK_SET_VALIDATION_DOCS_URL}
              target='_blank'
              rel='noopener noreferrer'
              className='underline'
              data-testid='linkset-validation-docs'
            >
              What the link set checks cover
            </a>
          </p>
          {credentialRows.length > 0 && (
            <div className='pt-2' data-testid='linked-credentials'>
              <p className='text-xs font-semibold text-muted-foreground'>
                Linked credentials · {credentialRows.length}
              </p>
              {/* The heading carries the total, so the row list can scroll: a resolver can answer
                  with hundreds of links and an unbounded card would swallow the page. */}
              <div className='mt-2 max-h-80 space-y-2 overflow-y-auto pr-1'>
                {credentialRows.map((row, index) => (
                  <LinkedCredentialRowView
                    key={`${row.href}-${index}`}
                    row={row}
                    linkSetId={linkSetKey(linkSet.source)}
                    coverage={rowOutcome(row)}
                    credentialItems={credentialItems}
                    urlBindings={urlBindings}
                    onVerifyCredential={onVerifyCredential}
                    beginUrlAttempt={beginUrlAttempt}
                    onVerifyRejected={onVerifyRejected}
                    isFetching={fetchingHrefs.has(`verify:${row.href}`)}
                    setFetching={(fetching) => setHrefFetching(`verify:${row.href}`, fetching)}
                    discoveredEncrypted={discoveredEncryptedHrefs.has(row.href)}
                    setDiscoveredEncrypted={(discovered) => setDiscoveredEncrypted(row.href, discovered)}
                  />
                ))}
              </div>
            </div>
          )}
          {secondaryRows.length > 0 && (
            <div className='pt-2' data-testid='secondary-resolvers'>
              <p className='text-xs font-semibold text-muted-foreground'>
                Secondary resolvers · {secondaryRows.length}
              </p>
              {/* The heading carries the total, so the row list can scroll: a resolver can answer
                  with many delegations and an unbounded card would swallow the page. */}
              <div className='mt-2 max-h-80 space-y-2 overflow-y-auto pr-1'>
                {secondaryRows.map((row, index) => (
                  <SecondaryResolverRowView
                    key={`${row.href}-${index}`}
                    row={row}
                    onResolveSecondary={onResolveSecondary}
                    isFetching={fetchingHrefs.has(`resolve:${row.href}`)}
                    setFetching={(fetching) => setHrefFetching(`resolve:${row.href}`, fetching)}
                  />
                ))}
              </div>
            </div>
          )}
          {otherLinkCount > 0 && (
            <p className='pt-1 text-xs text-muted-foreground' data-testid='other-links-note'>
              {credentialRows.length === 0 ? 'No UNTP credential links found. ' : ''}
              {otherLinkCount} other {otherLinkCount === 1 ? 'link' : 'links'} in this link set{' '}
              {otherLinkCount === 1
                ? 'is not identified as a UNTP credential'
                : 'are not identified as UNTP credentials'}
              .{' '}
              <a href={CREDENTIAL_LINKS_DOCS_URL} target='_blank' rel='noopener noreferrer' className='underline'>
                How credential links are identified
              </a>
            </p>
          )}
        </div>
      )}
      <button
        type='button'
        aria-label={`Remove ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        // Revealed only when the pointer is over the delete region itself (the right edge), or when
        // the control is keyboard-focused, rather than on hover of the whole card.
        className='absolute bottom-0 right-0 top-0 flex w-12 items-center justify-center bg-red-400 text-white opacity-0 transition-opacity hover:bg-red-500 hover:opacity-100 focus:opacity-100 focus-visible:opacity-100'
      >
        <Trash2 className='h-4 w-4' />
      </button>
    </Card>
  );
}

/**
 * One linked-credential row (#812). Its state derives from the page's URL bindings (the instance
 * this href's latest accepted ingestion produced), so the note survives card collapse and
 * re-render, follows a re-fetch from either entry point, and fails open to the Verify button when
 * the bound instance was removed. Nothing is fetched until Verify is clicked (targets may be
 * large, gated or encrypted). While the fetch itself runs the row shows a plain "Fetching..."
 * phase: no credential exists yet to group, hash or count, so the "Verifying in Credentials" note
 * and the tab activity begin at accepted ingestion (settled deviation from the ticket's
 * click-instant wording, recorded on the PR).
 */
function LinkedCredentialRowView({
  row,
  linkSetId,
  coverage,
  credentialItems,
  urlBindings,
  onVerifyCredential,
  beginUrlAttempt,
  onVerifyRejected,
  isFetching,
  setFetching,
  discoveredEncrypted,
  setDiscoveredEncrypted,
}: {
  row: LinkedCredentialRow;
  /** The link set's identity (resolver request URL or filename), recorded on the verified credential's source. */
  linkSetId: string;
  /** This row's Link Type Coverage outcome (#1007), shown beside its verification state. */
  coverage: RowCoverageOutcome | undefined;
  credentialItems: CredentialSlot[];
  urlBindings: UrlBindings;
  onVerifyCredential: (
    rawArtefact: unknown,
    source: ArtefactSource,
  ) => { accepted: false } | { accepted: true; instanceId: string; encrypted?: true; alreadyDecrypted?: true };
  beginUrlAttempt: () => number;
  onVerifyRejected: (urls: Array<string | undefined>, startedAt: number) => void;
  isFetching: boolean;
  setFetching: (fetching: boolean) => void;
  discoveredEncrypted: boolean;
  setDiscoveredEncrypted: (discovered: boolean) => void;
}) {
  const instance = resolveBoundInstance(urlBindings, row.href, credentialItems);
  const locked = instance?.payload.encryptedEnvelope === true;
  const steps = instance?.result ?? [];
  const settled = steps.length > 0 && steps.every((step) => TERMINAL_STATUSES.includes(step.status));
  const failed = settled && steps.some((step) => step.status === TestCaseStatus.FAILURE);
  // The bound instance is the strongest encryption evidence: locked shows the tag, and a
  // successfully decrypted (no longer locked) instance overrides an earlier fetch-time discovery.
  const showEncryptedTag = row.encrypted || (instance ? locked : discoveredEncrypted);

  const handleVerify = async () => {
    // Taken before the fetch: a rejection reported later only forgets bindings older than this.
    const startedAt = beginUrlAttempt();
    setFetching(true);
    try {
      const result = await fetchLinkedCredential(row.href);
      if (!result.ok) {
        onVerifyRejected([row.href], startedAt);
        toast.error(result.message);
        return;
      }
      const outcome = onVerifyCredential(result.credential, {
        kind: 'url',
        url: row.href,
        via: 'link-set',
        linkSet: linkSetId,
      });
      if (outcome.accepted && outcome.alreadyDecrypted) {
        // A known envelope rebinding to its decrypted instance: no pipeline restarted, so neither
        // the verifying nor the key toast would be honest.
        setDiscoveredEncrypted(false);
        toast.info('This credential was already decrypted and verified on the Credentials tab.');
      } else if (outcome.accepted && outcome.encrypted) {
        // The body is an encrypted envelope: it landed as a locked instance on the Credentials
        // tab (#813); record the discovery so the tag shows here too.
        setDiscoveredEncrypted(true);
        toast.info('This credential is encrypted. Enter its key on the Credentials tab to decrypt and verify it.');
      } else if (outcome.accepted) {
        // A plaintext accept is fresh evidence: drop any earlier encrypted discovery for this href.
        setDiscoveredEncrypted(false);
        toast.success(`Verifying ${row.label} in the Credentials tab`);
      } else {
        // The rejection details are already on the error surface (View Upload Detail); the toast
        // keeps the row's own feedback honest instead of announcing a verification that never began.
        onVerifyRejected([row.href], startedAt);
        toast.error('That link did not return an accepted credential. Open View Upload Detail for the reason.');
      }
    } catch (err) {
      // Ingestion is called raw here (not through the uploader's guarded wrapper), so a throw
      // anywhere in the pipeline chain must not vanish as an unhandled rejection.
      console.error('LinkedCredentialRowView: verify failed', err);
      onVerifyRejected([row.href], startedAt);
      toast.error('Could not process that credential. Check the link and try again.');
    } finally {
      setFetching(false);
    }
  };

  const verifyAction = (label: string) => (
    <Button
      type='button'
      variant='outline'
      size='sm'
      className='shrink-0'
      onClick={(e) => {
        e.stopPropagation();
        void handleVerify();
      }}
      data-testid={label === 'Verify' ? 'linked-credential-verify' : 'linked-credential-verify-again'}
    >
      {label}
    </Button>
  );

  return (
    <div className='flex items-center justify-between gap-3 rounded-md border p-3' data-testid='linked-credential-row'>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium'>
          {row.label}
          {showEncryptedTag && (
            <span
              className='ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800'
              data-testid='linked-credential-encrypted'
            >
              Encrypted
            </span>
          )}
        </p>
        <p className='truncate font-mono text-xs text-muted-foreground'>{row.href}</p>
        {coverage?.kind === 'excluded' && (
          <p className='text-xs text-muted-foreground' data-testid='linked-credential-coverage-excluded'>
            Not checked: no UNTP credential relation
          </p>
        )}
      </div>
      {isFetching ? (
        <span
          className='flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'
          data-testid='linked-credential-fetching'
        >
          <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' />
          Fetching...
        </span>
      ) : instance && locked ? (
        <span className='flex shrink-0 items-center gap-3'>
          <span className='text-xs text-muted-foreground' data-testid='linked-credential-locked'>
            Encrypted in Credentials tab
          </span>
          {/* Re-fetch stays available: the target may have been replaced with plaintext. */}
          {verifyAction('Verify again')}
        </span>
      ) : instance ? (
        <span className='flex shrink-0 items-center gap-3'>
          <span
            className='text-xs text-muted-foreground'
            data-testid={`linked-credential-${!settled ? 'verifying' : failed ? 'failed' : 'verified'}`}
          >
            {!settled ? 'Verifying in Credentials tab' : failed ? 'Failed in Credentials tab' : 'Verified'}
          </span>
          {/* Only a settled instance has a type to compare; an unsettled one already reads "Verifying". */}
          {settled && coverage && (coverage.kind === 'match' || coverage.kind === 'mismatch') && (
            <span
              className={`text-xs ${coverage.kind === 'mismatch' ? 'text-red-600' : 'text-muted-foreground'}`}
              data-testid={`linked-credential-coverage-${coverage.kind}`}
            >
              {coverage.kind === 'match' ? `Type matches ${coverage.expectedType}` : mismatchText(coverage)}
            </span>
          )}
          {/* A settled row can re-fetch (the target may have drifted); a running one cannot. */}
          {settled && verifyAction('Verify again')}
        </span>
      ) : (
        verifyAction('Verify')
      )}
    </div>
  );
}

/**
 * One secondary-resolver row (#974): a link the UNTP Identity Resolver specification's Secondary
 * Resolvers section defines (`idr` relation, link set target), with a Resolve action that loads
 * the target as its own card exactly as the resolve input would. Nothing resolves without the
 * click, which is also what bounds a delegation chain: each hop is explicit, and a re-resolve of
 * an already-loaded URL replaces its card in place rather than duplicating it.
 */
function SecondaryResolverRowView({
  row,
  onResolveSecondary,
  isFetching,
  setFetching,
}: {
  row: LinkedCredentialRow;
  onResolveSecondary: (href: string) => Promise<void>;
  isFetching: boolean;
  setFetching: (fetching: boolean) => void;
}) {
  const handleResolve = async () => {
    setFetching(true);
    try {
      await onResolveSecondary(row.href);
    } catch (err) {
      console.error('SecondaryResolverRowView: resolve failed', err);
      toast.error('Could not resolve that link set. Check the link and try again.');
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className='flex items-center justify-between gap-3 rounded-md border p-3' data-testid='secondary-resolver-row'>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium'>{row.label}</p>
        <p className='truncate font-mono text-xs text-muted-foreground'>{row.href}</p>
      </div>
      {isFetching ? (
        <span
          className='flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'
          data-testid='secondary-resolver-resolving'
        >
          <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' />
          Resolving...
        </span>
      ) : (
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='shrink-0'
          // The href keeps repeated titles distinguishable for assistive tech: resolvers routinely
          // reuse a generic title across delegation links.
          aria-label={`Resolve ${row.label} (${row.href})`}
          onClick={(e) => {
            e.stopPropagation();
            void handleResolve();
          }}
          data-testid='secondary-resolver-resolve'
        >
          Resolve
        </Button>
      )}
    </div>
  );
}
