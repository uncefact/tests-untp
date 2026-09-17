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
import {
  describeUnexpectedSchemeParse,
  parseSchemeStructure,
  schemeStructuralParseDetails,
  toSchemeStructuralParseDetails,
  type SchemeStructuralParseDetails,
} from '@/lib/schemeStructure';
import { SchemaFetchError, SchemaSelectionError, validateSchemeSchema } from '@/lib/schemeValidation';
import ValidationDetailsSheet from '@/components/ValidationDetailsSheet';
import { detectVersionFromContext } from '@uncefact/untp-utils/artefacts';
import { SUPPORTED_CVC_SPEC_VERSIONS } from '@uncefact/untp-utils/conformity-vocabulary';
import type { ArtefactSlot, CollectionState, InstanceId, RunId } from '@/types/artefact';
import type { StoredScheme, TestStep } from '@/types';
import type { DisplayableError } from '@/types/validation';
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

const schemeStepDefinitions = [
  { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection' },
  { id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION, name: 'Schema Validation' },
  { id: TestCaseStepId.SCHEME_STRUCTURAL_PARSE, name: 'Structural Parse' },
  { id: TestCaseStepId.CONTEXT_VALIDATION, name: 'JSON-LD Document Expansion and Context Validation' },
] as const;

export const SCHEME_STEP_DISPLAY_NAMES = schemeStepDefinitions.map((step) => step.name);

const initialSteps: TestStep[] = schemeStepDefinitions.map((step) => ({
  ...step,
  status: TestCaseStatus.PENDING,
}));

export function buildSchemaSelectionSkipMessage(): string {
  return 'Skipped: schema selection failed.';
}

export function buildUnsupportedParserSkipMessage(version: string): string {
  return `Skipped: the Playground has no parser for UNTP ${version}; it parses ${SUPPORTED_CVC_SPEC_VERSIONS.join(
    ', ',
  )}.`;
}

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

  // Schemes confirm removal with a dialog; link sets remove immediately with a toast + Undo. The
  // split is deliberate (per-family contract, see LinkSetTestResults), not an inconsistency to fix.
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

  const version = detectVersionFromContext(stored.decoded);
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
    setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
      status: TestCaseStatus.FAILURE,
      details: {
        errors: [{ message: 'Skipped: version detection failed.' }],
        diagnostics: [],
        skipped: true,
        blockedBy: TestCaseStepId.SCHEME_VERSION_DETECTION,
      } satisfies SchemeStructuralParseDetails,
    });
    setStep(TestCaseStepId.CONTEXT_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [{ message: 'Skipped: version detection failed.' }] },
    });
    return;
  }
  if (!setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, { status: TestCaseStatus.SUCCESS })) return;

  if (!setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, { status: TestCaseStatus.IN_PROGRESS })) return;
  let schemaSelectionFailed = false;
  try {
    const result = await validateSchemeSchema(stored.decoded, version);
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
      status: result.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
      details: result.valid ? undefined : { errors: result.errors },
    });
  } catch (err) {
    schemaSelectionFailed = err instanceof SchemaSelectionError;
    setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
      status: TestCaseStatus.FAILURE,
      details: { errors: [schemaFetchError(err)] },
    });
  }

  if (!setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, { status: TestCaseStatus.IN_PROGRESS })) return;
  try {
    if (schemaSelectionFailed) {
      setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
        status: TestCaseStatus.FAILURE,
        details: {
          errors: [{ message: buildSchemaSelectionSkipMessage() }],
          diagnostics: [],
          skipped: true,
          blockedBy: TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
        } satisfies SchemeStructuralParseDetails,
      });
    } else if (!SUPPORTED_CVC_SPEC_VERSIONS.some((supportedVersion) => supportedVersion === version)) {
      // blockedBy records the step that prevented parsing; the no-parser skip has no blocking step.
      setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
        status: TestCaseStatus.FAILURE,
        details: {
          errors: [
            {
              message: buildUnsupportedParserSkipMessage(version),
            },
          ],
          diagnostics: [],
          skipped: true,
        } satisfies SchemeStructuralParseDetails,
      });
    } else {
      const sourceUrl = stored.source?.kind === 'url' ? stored.source.url : `urn:untp-playground:scheme:${instanceId}`;
      const result = parseSchemeStructure(stored.decoded, { sourceUrl, specVersion: version });
      switch (result.kind) {
        case 'parsed':
          setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, { status: TestCaseStatus.SUCCESS });
          break;
        case 'document-failure':
          setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
            status: TestCaseStatus.FAILURE,
            details: toSchemeStructuralParseDetails(result),
          });
          break;
        case 'unsupported-version':
          setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
            status: TestCaseStatus.FAILURE,
            details: toSchemeStructuralParseDetails(result),
          });
          break;
        case 'unexpected':
          setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
            status: TestCaseStatus.FAILURE,
            details: toSchemeStructuralParseDetails(result),
          });
          break;
        default: {
          const exhaustive: never = result;
          throw new Error(`Unhandled scheme structure kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    }
  } catch (err) {
    setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
      status: TestCaseStatus.FAILURE,
      details: {
        errors: [
          {
            message: describeUnexpectedSchemeParse(err),
            supportable: true,
          },
        ],
        diagnostics: [],
      } satisfies SchemeStructuralParseDetails,
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

function isAjvError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { keyword?: unknown; instancePath?: unknown };
  return typeof candidate.keyword === 'string' && typeof candidate.instancePath === 'string';
}

function schemeMessageDetails(errors: DisplayableError[]) {
  return (
    <ul className='list-disc space-y-1 pl-6 text-sm text-red-600'>
      {errors.map((error, idx) => (
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
  );
}

function schemaFetchError(err: unknown): DisplayableError {
  // Selection failed before transport on the scheme's own version, so the uploader can act on it
  // and support cannot.
  if (err instanceof SchemaSelectionError) {
    return {
      message: `${err.message} Use a Conformity Scheme published for UNTP ${SUPPORTED_CVC_SPEC_VERSIONS.join(', ')}.`,
      supportable: false,
    };
  }
  if (err instanceof SchemaFetchError) {
    switch (err.reason) {
      case 'timeout':
        return { message: 'The schema service did not respond in time. Please try again.', supportable: true };
      case 'not-found':
        return {
          message: `No schema is published at ${
            err.schemaUrl
          }. Use a Conformity Scheme published for UNTP ${SUPPORTED_CVC_SPEC_VERSIONS.join(', ')}.`,
        };
      case 'parse':
        return {
          message: 'The schema service returned a response that was not valid JSON. Please try again.',
          supportable: true,
        };
      case 'network':
      default:
        // The message carries the schema service's own category (upstream
        // status, could not be loaded), which says more than a generic outage.
        return { message: `${err.message} Please try again.`, supportable: true };
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
            <SchemeStepItem key={step.id} step={step} />
          ))}
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

function SchemeStepItem({ step }: { step: TestStep }) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const errors = stepErrors(step);
  const structuralDetails = schemeStructuralParseDetails(step);
  const messageErrors = structuralDetails?.errors ?? errors;
  const ajvErrors = step.details?.errors;
  const usesErrorDialog =
    step.id === TestCaseStepId.SCHEME_SCHEMA_VALIDATION &&
    Array.isArray(ajvErrors) &&
    ajvErrors.length > 0 &&
    ajvErrors.every(isAjvError);

  return (
    <div className='py-2'>
      <div className='flex items-center justify-between' data-testid={`${step.id}-row`}>
        <div className='flex items-center gap-2'>
          <StatusIcon status={step.status} testId={step.id} />
          <span>{step.name}</span>
        </div>
        {step.status === TestCaseStatus.FAILURE && errors.length > 0 && step.details && (
          <ValidationDetailsSheet
            isOpen={isDetailsOpen}
            onOpenChange={setIsDetailsOpen}
            errors={step.details.errors}
            content={usesErrorDialog ? undefined : schemeMessageDetails(messageErrors)}
            trigger={
              <Button variant='ghost' size='sm' data-testid={`${step.id}-details-trigger`}>
                View Details
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
