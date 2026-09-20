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
import {
  classifySchemaFetchFailure,
  classifySchemaSelectionFailure,
  describeArtefactFailure,
  isUnexpectedFailure,
  notExecutedFailure,
  unexpectedFailure,
  type ArtefactStepFailure,
} from '@/lib/artefactFailure';
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
import { contextEntries, formatObserved } from '@/lib/schemaValidation';
import { SUPPORTED_CVC_SPEC_VERSIONS } from '@uncefact/untp-utils/conformity-vocabulary';
import type { ArtefactSlot, CollectionState, InstanceId, RunId } from '@/types/artefact';
import type { DisplayableError, StoredScheme, TestStep } from '@/types';
import confetti from 'canvas-confetti';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TestCaseStatus, TestCaseStepId } from '../../constants';
import { toast } from 'sonner';

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
  const setSteps = (patches: Array<[TestCaseStepId, Partial<TestStep>]>): boolean => {
    for (const [stepId, patch] of patches) {
      const index = steps.findIndex((step) => step.id === stepId);
      if (index !== -1) steps[index] = { ...steps[index], ...patch };
    }
    const { applied } = dispatch((state) =>
      commitResult(state, { instanceId, runId, result: steps.map((step) => ({ ...step })) }),
    );
    return applied;
  };
  const setStep = (stepId: TestCaseStepId, patch: Partial<TestStep>): boolean => setSteps([[stepId, patch]]);

  try {
    if (!setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, { status: TestCaseStatus.IN_PROGRESS })) return;

    const version = detectVersionFromContext(stored.decoded);
    if (!version) {
      const observedContexts = contextEntries(stored.decoded);
      const message =
        observedContexts.length === 0
          ? 'The scheme declares no @context entries, so no UNTP version can be detected.'
          : `The scheme declares @context entries ${formatObserved(
              observedContexts,
            )}, but none carries a recognised UNTP version.`;
      const failure = classifySchemaSelectionFailure({ reason: 'version-not-detected', message }, 'scheme');
      if (
        !setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, {
          status: TestCaseStatus.FAILURE,
          details: { errors: [{ message }] },
          failure,
        })
      ) {
        return;
      }
      const blockedByVersion = notExecutedFailure(TestCaseStepId.SCHEME_VERSION_DETECTION, 'scheme');
      if (
        !setSteps([
          [
            TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
            {
              status: TestCaseStatus.FAILURE,
              details: { errors: [{ message: 'Skipped: version detection failed.' }] },
              failure: blockedByVersion,
            },
          ],
          [
            TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
            {
              status: TestCaseStatus.FAILURE,
              details: {
                errors: [{ message: 'Skipped: version detection failed.' }],
                diagnostics: [],
                skipped: true,
                blockedBy: TestCaseStepId.SCHEME_VERSION_DETECTION,
              } satisfies SchemeStructuralParseDetails,
              failure: blockedByVersion,
            },
          ],
          [
            TestCaseStepId.CONTEXT_VALIDATION,
            {
              status: TestCaseStatus.FAILURE,
              details: { errors: [{ message: 'Skipped: version detection failed.' }] },
              failure: blockedByVersion,
            },
          ],
        ])
      ) {
        return;
      }
      return;
    }
    if (!setStep(TestCaseStepId.SCHEME_VERSION_DETECTION, { status: TestCaseStatus.SUCCESS, failure: undefined }))
      return;

    if (!setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, { status: TestCaseStatus.IN_PROGRESS, failure: undefined }))
      return;
    let schemaSelectionFailed = false;
    try {
      const result = await validateSchemeSchema(stored.decoded, version);
      if (
        !setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
          status: result.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
          details: result.valid ? undefined : { errors: result.errors },
          failure: result.valid ? undefined : result.failure,
        })
      ) {
        return;
      }
    } catch (error) {
      schemaSelectionFailed = error instanceof SchemaSelectionError || isSchemaSelectionErrorLike(error);
      const failure = classifySchemePipelineFailure(error, version);
      if (
        !setStep(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, {
          status: TestCaseStatus.FAILURE,
          details: {
            errors: [
              {
                message: error instanceof Error ? error.message : failure.message,
                supportable: failure.class === 'unknown',
              },
            ],
          },
          failure,
        })
      ) {
        return;
      }
      if (isUnexpectedFailure(failure)) {
        toast.error('Validation failed unexpectedly. Report the details to the Playground operator.');
      }
    }

    if (!setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, { status: TestCaseStatus.IN_PROGRESS, failure: undefined }))
      return;
    try {
      if (schemaSelectionFailed) {
        const failure = notExecutedFailure(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, 'scheme');
        if (
          !setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
            status: TestCaseStatus.FAILURE,
            details: {
              errors: [{ message: buildSchemaSelectionSkipMessage() }],
              diagnostics: [],
              skipped: true,
              blockedBy: TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
            } satisfies SchemeStructuralParseDetails,
            failure,
          })
        ) {
          return;
        }
      } else if (!SUPPORTED_CVC_SPEC_VERSIONS.some((supportedVersion) => supportedVersion === version)) {
        const failure = classifySchemaSelectionFailure(
          {
            reason: 'scheme-version-unsupported',
            message: `The declared Conformity Scheme version "${version}" has no parser in the Playground. Supported versions: ${SUPPORTED_CVC_SPEC_VERSIONS.join(
              ', ',
            )}.`,
          },
          'scheme',
        );
        if (
          !setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
            status: TestCaseStatus.FAILURE,
            details: {
              errors: [{ message: buildUnsupportedParserSkipMessage(version) }],
              diagnostics: [],
              skipped: true,
            } satisfies SchemeStructuralParseDetails,
            failure,
          })
        ) {
          return;
        }
      } else {
        const sourceUrl =
          stored.source?.kind === 'url' ? stored.source.url : `urn:untp-playground:scheme:${instanceId}`;
        const result = parseSchemeStructure(stored.decoded, { sourceUrl, specVersion: version });
        switch (result.kind) {
          case 'parsed':
            if (
              !setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, { status: TestCaseStatus.SUCCESS, failure: undefined })
            )
              return;
            break;
          case 'document-failure': {
            const failure: ArtefactStepFailure = {
              class: 'credential-invalid',
              code: 'conformity-scheme.parse-failed',
              message: 'The Conformity Scheme document failed structural parsing.',
              remediation: 'Correct the listed fields in the Conformity Scheme document.',
            };
            if (
              !setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
                status: TestCaseStatus.FAILURE,
                details: toSchemeStructuralParseDetails(result),
                failure,
              })
            ) {
              return;
            }
            break;
          }
          case 'unsupported-version': {
            const failure = classifySchemaSelectionFailure(
              {
                reason: 'scheme-version-unsupported',
                message: `The declared Conformity Scheme version "${
                  result.received
                }" is not supported by the Playground. Supported versions: ${SUPPORTED_CVC_SPEC_VERSIONS.join(', ')}.`,
              },
              'scheme',
            );
            if (
              !setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
                status: TestCaseStatus.FAILURE,
                details: toSchemeStructuralParseDetails(result),
                failure,
              })
            ) {
              return;
            }
            break;
          }
          case 'unexpected': {
            const failure = unexpectedFailure('playground.pipeline.step', result.message, 'scheme');
            if (
              !setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
                status: TestCaseStatus.FAILURE,
                details: toSchemeStructuralParseDetails(result),
                failure,
              })
            ) {
              return;
            }
            if (isUnexpectedFailure(failure)) {
              toast.error('Validation failed unexpectedly. Report the details to the Playground operator.');
            }
            break;
          }
          default: {
            const exhaustive: never = result;
            throw new Error(`Unhandled scheme structure kind: ${JSON.stringify(exhaustive)}`);
          }
        }
      }
    } catch (error) {
      const failure = classifySchemePipelineFailure(error, version);
      if (
        !setStep(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, {
          status: TestCaseStatus.FAILURE,
          details: {
            errors: [
              {
                message: describeUnexpectedSchemeParse(error),
                supportable: true,
              },
            ],
            diagnostics: [],
          } satisfies SchemeStructuralParseDetails,
          failure,
        })
      ) {
        return;
      }
      if (isUnexpectedFailure(failure)) {
        toast.error('Validation failed unexpectedly. Report the details to the Playground operator.');
      }
    }

    if (!setStep(TestCaseStepId.CONTEXT_VALIDATION, { status: TestCaseStatus.IN_PROGRESS, failure: undefined })) return;
    try {
      const contextResult = await validateContext(stored.decoded, 'scheme');
      if (
        !setStep(TestCaseStepId.CONTEXT_VALIDATION, {
          status: contextResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
          details: contextResult.valid ? undefined : { errors: contextResult.error ? [contextResult.error] : [] },
          failure: contextResult.valid ? undefined : contextResult.failure,
        })
      ) {
        return;
      }
    } catch (error) {
      const failure = classifySchemePipelineFailure(error, version);
      if (
        !setStep(TestCaseStepId.CONTEXT_VALIDATION, {
          status: TestCaseStatus.FAILURE,
          details: {
            errors: [
              {
                message: error instanceof Error ? error.message : 'Failed to validate JSON-LD context.',
                supportable: true,
              },
            ],
          },
          failure,
        })
      ) {
        return;
      }
      if (isUnexpectedFailure(failure)) {
        toast.error('Validation failed unexpectedly. Report the details to the Playground operator.');
      }
    }
  } catch (error) {
    const failure = unexpectedFailure(
      'playground.pipeline.unexpected',
      `The Playground could not complete validation for this scheme: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'scheme',
    );
    const unfinished = steps.filter(
      (step) => step.status === TestCaseStatus.PENDING || step.status === TestCaseStatus.IN_PROGRESS,
    );
    if (unfinished.length === 0) {
      console.error('SchemeTestResults: validation escaped after all steps settled', error);
      return;
    }
    const applied = setSteps(unfinished.map((step) => [step.id, { status: TestCaseStatus.FAILURE, failure }]));
    if (applied && isUnexpectedFailure(failure)) {
      toast.error('Validation failed unexpectedly. Report the details to the Playground operator.');
    }
  }
}

function stepErrors(step: TestStep): DisplayableError[] {
  const errors = step.details?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (error): error is DisplayableError =>
      typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string',
  );
}

function schemeMessageErrors(details: SchemeStructuralParseDetails) {
  return details.errors.map((error, index) => {
    const pointer = details.diagnostics[index]?.pointer;
    const prefix = `${pointer ?? 'document root'}: `;
    return {
      ...error,
      ...(pointer !== undefined ? { pointer } : {}),
      message: error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message,
    };
  });
}

function classifySchemePipelineFailure(error: unknown, declaredVersion?: string): ArtefactStepFailure {
  if (error instanceof SchemaFetchError || isSchemaFetchErrorLike(error)) {
    return classifySchemaFetchFailure(error as SchemaFetchError, 'scheme', declaredVersion);
  }
  if (error instanceof SchemaSelectionError || isSchemaSelectionErrorLike(error)) {
    const candidate = error as { reason: SchemaSelectionError['reason']; message: string };
    return classifySchemaSelectionFailure(candidate, 'scheme');
  }
  return unexpectedFailure(
    'playground.pipeline.step',
    `The scheme validation step failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
    'scheme',
  );
}

function isSchemaFetchErrorLike(error: unknown): error is SchemaFetchError {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.schemaUrl === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.reason === 'string' &&
    typeof candidate.message === 'string'
  );
}

function isSchemaSelectionErrorLike(error: unknown): error is SchemaSelectionError {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.message === 'string' &&
    [
      'version-not-detected',
      'unknown-type',
      'unsupported-extension-version',
      'vcdm-version-unmapped',
      'scheme-version-unsupported',
      'builder',
    ].includes(String(candidate.reason))
  );
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
        className='relative flex flex-wrap items-center justify-between gap-2 cursor-pointer'
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
        <button
          type='button'
          aria-label={`Remove ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          // Revealed only when the pointer is over the header row's delete region, or when the
          // control is keyboard-focused, rather than on hover of the whole card.
          className='absolute inset-y-0 right-0 flex w-12 items-center justify-center bg-red-400 text-white opacity-0 transition-opacity hover:bg-red-500 hover:opacity-100 focus:opacity-100 focus-visible:opacity-100'
        >
          <Trash2 className='h-4 w-4' />
        </button>
      </div>
      {isExpanded && (
        <div className='mt-4 space-y-2 pl-6' data-testid='scheme-group-body'>
          {scheme.source && <SourceCaption source={scheme.source} />}
          {steps.map((step) => (
            <SchemeStepItem key={step.id} step={step} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SchemeStepItem({ step }: { step: TestStep }) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const errors = stepErrors(step);
  const failurePresentation = describeArtefactFailure(step.failure, 'scheme');
  const structuralDetails = schemeStructuralParseDetails(step);
  const isNotExecuted = step.failure?.code === 'playground.pipeline.not-executed';
  const dialogErrors = isNotExecuted ? [] : structuralDetails ? schemeMessageErrors(structuralDetails) : errors;

  return (
    <div className='py-2'>
      <div className='flex items-center justify-between' data-testid={`${step.id}-row`}>
        <div className='flex items-center gap-2'>
          <StatusIcon status={step.status} testId={step.id} />
          <span>{step.name}</span>
        </div>
        {step.status === TestCaseStatus.FAILURE && (failurePresentation || errors.length > 0) && (
          <ValidationDetailsSheet
            isOpen={isDetailsOpen}
            onOpenChange={setIsDetailsOpen}
            errors={dialogErrors}
            failure={step.failure}
            family='scheme'
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
