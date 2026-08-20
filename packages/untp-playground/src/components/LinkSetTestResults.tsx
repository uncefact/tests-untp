'use client';

import { SourceCaption } from '@/components/SourceCaption';
import { StatusIcon } from '@/components/StatusIcon';
import { Card } from '@/components/ui/card';
import { beginRun, commitResult, remove, restore } from '@/lib/artefactCollection';
import { linkedCredentialRows, linkSetSubtitle, linkSetTitle } from '@/lib/linkSetCollection';

import { linkSetValidationSteps } from '@/lib/linkSetValidation';
import { newId } from '@/lib/id';
import type { ArtefactSlot, CollectionState } from '@/types/artefact';
import type { StoredLinkSet, TestStep } from '@/types';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CREDENTIAL_LINKS_DOCS_URL, TestCaseStatus } from '../../constants';

type LinkSetCollection = CollectionState<StoredLinkSet, TestStep[]>;
type LinkSetDispatch = <Res extends { state: LinkSetCollection }>(
  transition: (current: LinkSetCollection) => Res,
) => Res;
type LinkSetSlot = ArtefactSlot<StoredLinkSet, TestStep[]>;

interface LinkSetTestResultsProps {
  collection: LinkSetCollection;
  dispatch: LinkSetDispatch;
}

export function LinkSetTestResults({ collection, dispatch }: LinkSetTestResultsProps) {
  // Settle every fresh instance immediately with the stubbed step list: schema validation has not
  // landed yet (#811), so there is no async pipeline to run. Committing the result straight away
  // is what keeps a landed link set removable and its card out of the mid-run spinner state.
  useEffect(() => {
    for (const item of collection.items) {
      if (item.runId === null && item.result === undefined) {
        const { runId } = dispatch((state) => beginRun(state, item.instanceId, linkSetValidationSteps(), newId));
        if (runId) {
          dispatch((state) =>
            commitResult(state, { instanceId: item.instanceId, runId, result: linkSetValidationSteps() }),
          );
        }
      }
    }
  }, [collection.items, dispatch]);

  // Remove is a single-level undo (#811): no confirm dialog, a toast with Undo restores the slot
  // at its old position. restore() no-ops when the same link set was re-added before undoing.
  const handleRemove = (item: LinkSetSlot) => {
    const index = collection.items.findIndex((candidate) => candidate.instanceId === item.instanceId);
    dispatch((state) => remove(state, item.instanceId));
    // A stable toast id makes a newer removal replace the previous toast, enforcing ADR-047's
    // single-level undo instead of stacking several live Undo actions.
    toast.success(`Removed ${linkSetTitle(item.payload)}`, {
      id: 'linkset-remove-undo',
      action: {
        label: 'Undo',
        onClick: () => {
          const { restored } = dispatch((state) => restore(state, item, index));
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
        <LinkSetCard key={item.instanceId} item={item} onRemove={() => handleRemove(item)} />
      ))}
    </section>
  );
}

function LinkSetCard({ item, onRemove }: { item: LinkSetSlot; onRemove: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const linkSet = item.payload;
  const steps = item.result ?? [];
  const title = linkSetTitle(linkSet);
  const allRows = linkedCredentialRows(linkSet.decoded);
  // Split by the UNTP Identity Resolver spec's credential-link rule (relation dpp/dcc/dfr/dte or
  // a verifiable-credential media type). Other links are counted, not listed: the playground
  // validates credentials, and the docs page explains how the split is decided.
  const credentialRows = allRows.filter((row) => row.credential);
  const otherLinkCount = allRows.length - credentialRows.length;

  // Pending steps mean "validation not yet available", not "still running": there is no live
  // pipeline this phase, so the card shows the quiet pending state rather than a spinner.
  const overallStatus =
    steps.length > 0 && steps.some((step) => step.status === TestCaseStatus.FAILURE)
      ? TestCaseStatus.FAILURE
      : steps.every((step) => step.status === TestCaseStatus.SUCCESS) && steps.length > 0
        ? TestCaseStatus.SUCCESS
        : TestCaseStatus.PENDING;

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
            <span className='truncate text-xs text-gray-500'>{linkSetSubtitle()}</span>
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
                {step.status === TestCaseStatus.PENDING && (
                  <span className='text-xs text-muted-foreground' data-testid='linkset-validation-note'>
                    not yet run — link set validation arrives in a later release
                  </span>
                )}
              </div>
            </div>
          ))}
          {credentialRows.length > 0 && (
            <div className='pt-2' data-testid='linked-credentials'>
              <p className='text-xs font-semibold text-muted-foreground'>
                Linked credentials · {credentialRows.length}
              </p>
              {/* The heading carries the total, so the row list can scroll: a resolver can answer
                  with hundreds of links and an unbounded card would swallow the page. */}
              <div className='mt-2 max-h-80 space-y-2 overflow-y-auto pr-1'>
                {credentialRows.map((row, index) => (
                  <div
                    key={`${row.href}-${index}`}
                    className='rounded-md border p-3'
                    data-testid='linked-credential-row'
                  >
                    <p className='truncate text-sm font-medium'>{row.label}</p>
                    <p className='truncate font-mono text-xs text-muted-foreground'>{row.href}</p>
                  </div>
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
