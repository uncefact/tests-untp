'use client';

import { SourceCaption } from '@/components/SourceCaption';
import { StatusIcon } from '@/components/StatusIcon';
import { confettiConfig } from '@/components/TestResults';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { beginRun, commitResult, remove } from '@/lib/artefactCollection';
import { validateContext } from '@/lib/contextValidation';
import { newId } from '@/lib/id';
import { schemeSubtitle, schemeTitle } from '@/lib/schemeCollection';
import { detectSchemeVersion, SchemaFetchError, validateSchemeSchema } from '@/lib/schemeValidation';
import type { ArtefactSlot, CollectionState, InstanceId, RunId } from '@/types/artefact';
import type { StoredScheme, TestStep } from '@/types';
import confetti from 'canvas-confetti';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

type SchemeCollection = CollectionState<StoredScheme, TestStep[]>;
type SchemeDispatch = <Res extends { state: SchemeCollection }>(transition: (current: SchemeCollection) => Res) => Res;
type SchemeSlot = ArtefactSlot<StoredScheme, TestStep[]>;

interface SchemeTestResultsProps {
  collection: SchemeCollection;
  dispatch: SchemeDispatch;
}

const initialSteps: TestStep[] = [
  { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.PENDING },
  { id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION, name: 'Schema Validation', status: TestCaseStatus.PENDING },
  {
    id: TestCaseStepId.CONTEXT_VALIDATION,
    name: 'JSON-LD Document Expansion and Context Validation',
    status: TestCaseStatus.PENDING,
  },
];

const freshSteps = (): TestStep[] => initialSteps.map((step) => ({ ...step }));

export function SchemeTestResults({ collection, dispatch }: SchemeTestResultsProps) {
  // Confetti fires once per (instance, run) so it does not re-fire on unrelated re-renders.
  const confettiShownRef = useRef<Set<string>>(new Set());
  const [pendingRemoval, setPendingRemoval] = useState<SchemeSlot | null>(null);

  // Start the pipeline for any instance that has no live run and no result yet (freshly added or
  // replaced). beginRun no-ops on an already-running slot, so a repeated effect cannot double-start.
  useEffect(() => {
    for (const item of collection.items) {
      if (item.runId === null && item.result === undefined) {
        const { runId } = dispatch((state) => beginRun(state, item.instanceId, freshSteps(), newId));
        if (runId) void runSchemePipeline(item.instanceId, runId, item.payload, dispatch);
      }
    }
  }, [collection.items, dispatch]);

  useEffect(() => {
    for (const item of collection.items) {
      const steps = item.result;
      if (!steps || item.runId === null) continue;
      const key = `${item.instanceId}:${item.runId}`;
      if (confettiShownRef.current.has(key)) continue;
      if (steps.length > 0 && steps.every((step) => step.status === TestCaseStatus.SUCCESS)) {
        confettiShownRef.current.add(key);
        confetti(confettiConfig);
      }
    }
  }, [collection.items]);

  const confirmRemoval = () => {
    if (!pendingRemoval) return;
    dispatch((state) => remove(state, pendingRemoval.instanceId));
    setPendingRemoval(null);
  };

  return (
    <section className='space-y-4' data-testid='scheme-results'>
      {collection.items.map((item) => (
        <SchemeCard key={item.instanceId} item={item} onRemove={() => setPendingRemoval(item)} />
      ))}

      <Dialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Remove {pendingRemoval ? schemeTitle(pendingRemoval.payload) : 'scheme'}?</DialogTitle>
            <DialogDescription>
              This removes the scheme and its validation results from this session. You can add it again by uploading
              it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setPendingRemoval(null)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={confirmRemoval}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

async function runSchemePipeline(
  instanceId: InstanceId,
  runId: RunId,
  stored: StoredScheme,
  dispatch: SchemeDispatch,
): Promise<void> {
  const steps = freshSteps();

  // The only write path: commit the whole step list through the run guard. Returns false once the
  // run has been superseded (replaced or removed), so a stale run stops writing.
  const setStep = (stepId: TestCaseStepId, patch: Partial<TestStep>): boolean => {
    const index = steps.findIndex((step) => step.id === stepId);
    if (index !== -1) steps[index] = { ...steps[index], ...patch };
    const { applied } = dispatch((state) =>
      commitResult(state, { instanceId, runId, result: steps.map((step) => ({ ...step })) }),
    );
    return applied;
  };

  if (!setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, { status: TestCaseStatus.IN_PROGRESS })) return;

  const version = detectSchemeVersion(stored.decoded);
  if (!version) {
    const message =
      'Could not detect a UNTP version from the @context. Add a UNTP context URI (e.g. https://vocabulary.uncefact.org/untp/0.7.0/context/).';
    setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [{ message }] },
    });
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [{ message: 'Skipped: version detection failed.' }] },
    });
    setStep(TestCaseStepId.CONTEXT_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [{ message: 'Skipped: version detection failed.' }] },
    });
    return;
  }
  if (!setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, { status: TestCaseStatus.SUCCESS })) return;

  if (!setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, { status: TestCaseStatus.IN_PROGRESS })) return;
  try {
    const result = await validateSchemeSchema(stored.decoded, version);
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
      status: result.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
      details: result.valid ? undefined : { errors: result.errors },
    });
  } catch (err) {
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [schemaFetchError(err)] },
    });
  }

  if (!setStep(TestCaseStepId.CONTEXT_VALIDATION, { status: TestCaseStatus.IN_PROGRESS })) return;
  try {
    const contextResult = await validateContext(stored.decoded);
    setStep(TestCaseStepId.CONTEXT_VALIDATION, {
      status: contextResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
      details: contextResult.valid ? undefined : { errors: contextResult.error ? [contextResult.error] : [] },
    });
  } catch (err) {
    setStep(TestCaseStepId.CONTEXT_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: {
        errors: [
          {
            message: err instanceof Error ? err.message : 'Failed to validate JSON-LD context.',
            supportable: true,
          },
        ],
      },
    });
  }
}

const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL || 'https://github.com/uncefact/tests-untp/issues';

interface DisplayableError {
  message: string;
  supportable?: boolean;
}

function stepErrors(step: TestStep): DisplayableError[] {
  const errors = step.details?.errors;
  if (!Array.isArray(errors)) return [];
  const out: DisplayableError[] = [];
  for (const e of errors) {
    if (typeof e?.message !== 'string' || e.message.length === 0) continue;
    out.push({ message: e.message, supportable: e.supportable === true });
  }
  return out;
}

function schemaFetchError(err: unknown): DisplayableError {
  if (err instanceof SchemaFetchError) {
    switch (err.reason) {
      case 'timeout':
        return { message: 'The schema service did not respond in time. Please try again.', supportable: true };
      case 'not-found':
        return {
          message: `No schema is published at ${err.schemaUrl}. Check that the scheme's @context references a UNTP version with a published schema.`,
        };
      case 'parse':
        return {
          message: 'The schema service returned a response that was not valid JSON. Please try again.',
          supportable: true,
        };
      case 'network':
      default:
        return { message: 'We could not reach the schema service. Please try again.', supportable: true };
    }
  }
  return {
    message: err instanceof Error ? err.message : 'Schema validation failed for an unknown reason.',
    supportable: true,
  };
}

function SchemeCard({ item, onRemove }: { item: SchemeSlot; onRemove: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const scheme = item.payload;
  const steps = item.result ?? [];
  const title = schemeTitle(scheme);

  const overallStatus = useMemo(() => {
    if (steps.length === 0) return TestCaseStatus.PENDING;
    if (steps.some((step) => step.status === TestCaseStatus.IN_PROGRESS || step.status === TestCaseStatus.PENDING)) {
      return TestCaseStatus.IN_PROGRESS;
    }
    return steps.every((step) => step.status === TestCaseStatus.SUCCESS)
      ? TestCaseStatus.SUCCESS
      : TestCaseStatus.FAILURE;
  }, [steps]);

  return (
    <Card className='group relative overflow-hidden p-4'>
      <div
        className='flex flex-wrap items-center justify-between gap-2 cursor-pointer'
        onClick={() => setIsExpanded((prev) => !prev)}
        data-testid='scheme-group-header'
        data-instance-id={item.instanceId}
      >
        <div className='flex min-w-0 items-center gap-2'>
          {isExpanded ? <ChevronDown className='h-4 w-4 shrink-0' /> : <ChevronRight className='h-4 w-4 shrink-0' />}
          <div className='flex min-w-0 flex-col'>
            <h3 className='truncate font-semibold'>{title}</h3>
            <span className='truncate text-xs text-gray-500'>{schemeSubtitle(scheme)}</span>
          </div>
        </div>
        <StatusIcon status={overallStatus} testId={item.instanceId} />
      </div>
      {isExpanded && (
        <div className='mt-4 space-y-2 pl-6'>
          {scheme.source && <SourceCaption source={scheme.source} />}
          {steps.map((step) => (
            <div key={step.id} className='py-2'>
              <div className='flex items-center gap-2'>
                <StatusIcon status={step.status} testId={step.id} />
                <span>{step.name}</span>
              </div>
              {step.status === TestCaseStatus.FAILURE && stepErrors(step).length > 0 && (
                <ul className='mt-1 list-disc space-y-1 pl-6 text-sm text-red-600'>
                  {stepErrors(step).map((error, idx) => (
                    <li key={idx}>
                      {error.message}
                      {error.supportable && (
                        <>
                          {' '}
                          If this keeps happening,{' '}
                          <a href={SUPPORT_URL} target='_blank' rel='noopener noreferrer' className='underline'>
                            report an issue
                          </a>
                          .
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      <button
        type='button'
        aria-label={`Remove ${title}`}
        onClick={onRemove}
        // Revealed only when the pointer is over the delete region itself (the right edge), or when
        // the control is keyboard-focused, rather than on hover of the whole card.
        className='absolute bottom-0 right-0 top-0 flex w-12 items-center justify-center bg-red-400 text-white opacity-0 transition-opacity hover:bg-red-500 hover:opacity-100 focus:opacity-100 focus-visible:opacity-100'
      >
        <Trash2 className='h-4 w-4' />
      </button>
    </Card>
  );
}
