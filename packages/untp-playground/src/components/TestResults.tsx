'use client';

import { SourceCaption } from '@/components/SourceCaption';
import { StatusIcon } from '@/components/StatusIcon';
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
import { beginRun, commitResult, remove, replacePayload } from '@/lib/artefactCollection';
import { validateContext } from '@/lib/contextValidation';
import {
  credentialContentHash,
  credentialGroupLabel,
  credentialGroupType,
  credentialIsTerminal,
  credentialSubtitle,
  credentialTitle,
  instanceStatus,
  worstStatus,
} from '@/lib/credentialCollection';
import { decodeEnvelopedCredential, isEnvelopedProof } from '@/lib/credentialService';
import { newId } from '@/lib/id';
import { detectExtension, validateCredentialSchema, validateExtension } from '@/lib/schemaValidation';
import { detectVcdmVersion } from '@/lib/utils';
import { validateVcdmRules } from '@/lib/vcdm-validation';
import { verifyCredential } from '@/lib/verificationService';
import type { ArtefactSlot, CollectionState, InstanceId, RunId } from '@/types/artefact';
import type { StoredCredential, TestStep } from '@/types';
import confetti from 'canvas-confetti';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  allowedContextValue,
  allowedExtensionValue,
  permittedCredentialTypes,
  TestCaseStatus,
  TestCaseStepId,
  VCDMVersion,
  VCProofType,
} from '../../constants';
import ValidationDetailsSheet from './ValidationDetailsSheet';
import { DecryptCredential } from './DecryptCredential';
import type { EncryptedCredentialEnvelope } from '@/lib/decryptCredential';

type CredentialCollection = CollectionState<StoredCredential, TestStep[]>;
type CredentialDispatch = <Res extends { state: CredentialCollection }>(
  transition: (current: CredentialCollection) => Res,
) => Res;
type CredentialSlot = ArtefactSlot<StoredCredential, TestStep[]>;

interface TestResultsProps {
  collection: CredentialCollection;
  dispatch: CredentialDispatch;
  /** Admits a decrypted plaintext through the page's upload gates; false keeps the card locked. */
  onDecrypted: (item: CredentialSlot, credential: unknown) => boolean;
}

export const confettiConfig = {
  particleCount: 200,
  spread: 90,
  origin: { y: 0.7 },
};

/**
 * The credential pipeline's starting step list. Proof type and VCDM version are detected
 * synchronously from the stored document, so they carry their final status immediately; every
 * other step (and the extension step, only when an extension is detected) starts pending and is
 * settled by `runCredentialPipeline`.
 */
function initialSteps(stored: StoredCredential): TestStep[] {
  const vcdmVersion = detectVcdmVersion(stored.decoded);
  const isUnsupportedVCDMVersion = vcdmVersion === VCDMVersion.UNKNOWN;

  const steps: TestStep[] = [];
  if (stored.decryptedFromEnvelope) {
    // Decrypted this session (#813): the pipeline leads with the already-successful Decryption
    // step so the card records how the document was obtained.
    steps.push({ id: TestCaseStepId.DECRYPTION, name: 'Decryption', status: TestCaseStatus.SUCCESS });
  }
  steps.push(
    {
      id: TestCaseStepId.PROOF_TYPE,
      name: 'Proof Type Detection',
      status: TestCaseStatus.SUCCESS,
      details: { type: isEnvelopedProof(stored.original) ? VCProofType.ENVELOPING : VCProofType.EMBEDDED },
    },
    {
      id: TestCaseStepId.VCDM_VERSION,
      name: 'VCDM Version Detection',
      status: isUnsupportedVCDMVersion ? TestCaseStatus.FAILURE : TestCaseStatus.SUCCESS,
      details: { version: vcdmVersion },
    },
    { id: TestCaseStepId.VCDM_SCHEMA_VALIDATION, name: 'VCDM Schema Validation', status: TestCaseStatus.PENDING },
    { id: TestCaseStepId.VERIFICATION, name: 'Credential Verification', status: TestCaseStatus.PENDING },
    { id: TestCaseStepId.UNTP_SCHEMA_VALIDATION, name: 'UNTP Schema Validation', status: TestCaseStatus.PENDING },
    {
      id: TestCaseStepId.CONTEXT_VALIDATION,
      name: 'JSON-LD Document Expansion and Context Validation',
      status: TestCaseStatus.PENDING,
    },
  );

  if (detectExtension(stored.decoded)) {
    steps.push({
      id: TestCaseStepId.EXTENSION_SCHEMA_VALIDATION,
      name: 'Extension Schema Validation',
      status: TestCaseStatus.PENDING,
    });
  }

  return steps;
}

export function TestResults({ collection, dispatch, onDecrypted }: TestResultsProps) {
  // Confetti fires once per (instance, run) so it does not re-fire on unrelated re-renders.
  const confettiShownRef = useRef<Set<string>>(new Set());
  const [pendingRemoval, setPendingRemoval] = useState<CredentialSlot | null>(null);

  // Start the pipeline for any instance that has no live run and no result yet (freshly added or
  // replaced). beginRun no-ops on an already-running slot, so a repeated effect cannot double-start.
  useEffect(() => {
    for (const item of collection.items) {
      if (item.runId === null && item.result === undefined) {
        // A locked instance's terminal WARNING result is seeded at ingestion; this guard only
        // defends against a future path that recreates a lock without one, and above all keeps
        // the pipeline off ciphertext (#813).
        if (item.payload.encryptedEnvelope) continue;
        const { runId } = dispatch((state) => beginRun(state, item.instanceId, initialSteps(item.payload), newId));
        if (runId) void runCredentialPipeline(item.instanceId, runId, item.payload, dispatch);
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

  // Group instances by detected credential type, in the fixed checklist order, and keep a group
  // only for a type that has at least one instance (#845): no empty type cards, no n / 5
  // denominator.
  const groups = useMemo(
    () =>
      permittedCredentialTypes
        .map((type) => ({
          type,
          instances: collection.items.filter(
            (item) => !item.payload.encryptedEnvelope && credentialGroupType(item.payload.decoded) === type,
          ),
        }))
        .filter((group) => group.instances.length > 0),
    [collection.items],
  );
  // Locked instances have no detectable type until decrypted, so they list under their own
  // heading rather than vanishing from the typed groups (#813).
  const lockedInstances = useMemo(
    () => collection.items.filter((item) => item.payload.encryptedEnvelope),
    [collection.items],
  );

  return (
    <section className='space-y-4' data-testid='credential-results'>
      {lockedInstances.length > 0 && (
        <CredentialTypeGroup
          type='Encrypted'
          instances={lockedInstances}
          onRemove={(item) => setPendingRemoval(item)}
          onDecrypted={onDecrypted}
        />
      )}
      {groups.map((group) => (
        <CredentialTypeGroup
          key={group.type}
          type={group.type}
          instances={group.instances}
          onRemove={(item) => setPendingRemoval(item)}
          onDecrypted={onDecrypted}
        />
      ))}

      <Dialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Remove {pendingRemoval ? credentialTitle(pendingRemoval.payload) : 'credential'}?</DialogTitle>
            <DialogDescription>
              This removes the credential and its validation results from this session. You can add it again by
              uploading it.
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

/**
 * Runs the credential validation pipeline (proof type and VCDM version are pre-computed in
 * `initialSteps`; this settles VCDM schema, verification, UNTP schema, JSON-LD context and, when
 * detected, the extension schema) and commits the whole step list through the run-guarded
 * `commitResult` after each stage, like `runSchemePipeline`. Step statuses and detail shapes follow
 * the pre-#810 implementation; the write path moved onto the shared per-instance model (ADR-041),
 * and each async step (verification included) fails its own step and honours the run guard before
 * toasting, so a service error settles the instance rather than leaving it stuck.
 */
async function runCredentialPipeline(
  instanceId: InstanceId,
  runId: RunId,
  stored: StoredCredential,
  dispatch: CredentialDispatch,
): Promise<void> {
  const steps = initialSteps(stored);

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
    // Mark the four asynchronous steps in progress together, mirroring the original single-pass
    // update rather than one commit per step.
    if (
      !setSteps([
        [TestCaseStepId.VERIFICATION, { status: TestCaseStatus.IN_PROGRESS }],
        [TestCaseStepId.UNTP_SCHEMA_VALIDATION, { status: TestCaseStatus.IN_PROGRESS }],
        [TestCaseStepId.VCDM_SCHEMA_VALIDATION, { status: TestCaseStatus.IN_PROGRESS }],
        [TestCaseStepId.CONTEXT_VALIDATION, { status: TestCaseStatus.IN_PROGRESS }],
      ])
    ) {
      return;
    }

    // A verification-service error (unconfigured service, downstream 5xx, network) must fail the
    // verification step visibly and let the remaining steps settle. Without this catch the throw
    // reaches the outer handler and leaves the instance stuck IN_PROGRESS: non-terminal, so
    // non-removable and blocking report generation for the whole session.
    try {
      const verificationResult = await verifyCredential(stored.original);
      if (
        !setStep(TestCaseStepId.VERIFICATION, {
          status: verificationResult.verified ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
          details: {
            verified: verificationResult.verified,
            ...(verificationResult.error && { error: verificationResult.error }),
          },
        })
      ) {
        return;
      }

      if (!verificationResult.verified) {
        const errorMessage =
          typeof verificationResult.error === 'object'
            ? verificationResult.error.message || 'The credential could not be verified'
            : verificationResult.error || 'The credential could not be verified';

        toast.error('Credential verification failed', { description: errorMessage });
      }
    } catch {
      const description = 'Could not reach the verification service. Please try again.';
      // Commit the failure through the run guard first; a superseded run stops here and stays silent.
      if (
        !setStep(TestCaseStepId.VERIFICATION, {
          status: TestCaseStatus.FAILURE,
          details: { verified: false, error: description },
        })
      ) {
        return;
      }
      toast.error('Credential verification failed', { description });
    }

    const extension = detectExtension(stored.decoded);

    try {
      const vcdmValidationResult = await validateVcdmRules(stored.decoded);
      if (
        !setStep(TestCaseStepId.VCDM_SCHEMA_VALIDATION, {
          status: vcdmValidationResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
          details: vcdmValidationResult,
        })
      ) {
        return;
      }
    } catch {
      if (!setStep(TestCaseStepId.VCDM_SCHEMA_VALIDATION, { status: TestCaseStatus.FAILURE })) return;
      toast.error('Failed to fetch the VCDM schema. Please contact support.');
    }

    try {
      const validationResult = await validateCredentialSchema(stored.decoded);
      if (
        !setStep(TestCaseStepId.UNTP_SCHEMA_VALIDATION, {
          status: validationResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
          details: validationResult,
        })
      ) {
        return;
      }
    } catch (error) {
      console.log('Schema validation error:', error);
      if (
        !setStep(TestCaseStepId.UNTP_SCHEMA_VALIDATION, {
          status: TestCaseStatus.FAILURE,
          details: {
            errors: [
              {
                keyword: 'schema',
                message: 'Failed to fetch schema',
                instancePath: '',
                params: {
                  missingValue: 'The schema could not be loaded due to missing UNTP context IRIs.',
                  solution: "Ensure the credential includes the required UNTP context IRIs in the '@context' field.",
                  allowedValue: allowedContextValue,
                  receivedValue: stored,
                },
              },
            ],
          },
        })
      ) {
        return;
      }
      toast.error('Failed to fetch schema. Please try again.');
    }

    try {
      const validateContextResult = await validateContext(stored.decoded);
      if (
        !setStep(TestCaseStepId.CONTEXT_VALIDATION, {
          status: validateContextResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
          details: validateContextResult.valid
            ? validateContextResult.data
            : { errors: validateContextResult.error ? [validateContextResult.error] : [] },
        })
      ) {
        return;
      }
      if (!validateContextResult.valid) {
        toast.error('Validation of the JSON-LD context failed. Please check the View Details for more information.');
      }
    } catch (error) {
      console.log('Context validation error:', error);
      if (
        !setStep(TestCaseStepId.CONTEXT_VALIDATION, {
          status: TestCaseStatus.FAILURE,
          details: {
            errors: [
              {
                keyword: 'context',
                message: error instanceof Error ? error.message : 'Failed to validate the JSON-LD context',
                instancePath: '',
              },
            ],
          },
        })
      ) {
        return;
      }
      toast.error('Validation of the JSON-LD context failed. Please try again.');
    }

    if (extension) {
      try {
        const extensionValidationResult = await validateExtension(stored.decoded);
        if (
          !setStep(TestCaseStepId.EXTENSION_SCHEMA_VALIDATION, {
            status: extensionValidationResult.valid ? TestCaseStatus.SUCCESS : TestCaseStatus.FAILURE,
            details: extensionValidationResult,
          })
        ) {
          return;
        }
      } catch (error) {
        console.log('Extension schema validation error:', error);
        if (
          !setStep(TestCaseStepId.EXTENSION_SCHEMA_VALIDATION, {
            status: TestCaseStatus.FAILURE,
            details: {
              errors: [
                {
                  keyword: 'schema',
                  message: 'Failed to fetch extension schema',
                  instancePath: '',
                  params: {
                    missingValue: 'The schema could not be loaded due to missing extension context IRIs.',
                    solution:
                      "Ensure the credential includes the required extension context IRIs in the '@context' field.",
                    allowedValue: allowedExtensionValue,
                    receivedValue: stored,
                  },
                },
              ],
            },
          })
        ) {
          return;
        }
        toast.error('Failed to fetch extension schema. Please try again.');
      }
    }
  } catch (error) {
    console.log('Error processing credential:', error);
  }
}

function CredentialTypeGroup({
  type,
  instances,
  onRemove,
  onDecrypted,
}: {
  type: string;
  instances: CredentialSlot[];
  onRemove: (item: CredentialSlot) => void;
  onDecrypted: (item: CredentialSlot, credential: unknown) => boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  const rollup = useMemo(() => worstStatus(instances.map((item) => instanceStatus(item.result))), [instances]);

  return (
    <Card className='p-4'>
      <div
        className='flex flex-wrap items-center justify-between gap-2 cursor-pointer'
        onClick={() => setIsExpanded((prev) => !prev)}
        data-testid={`${type}-group-header`}
      >
        <div className='flex items-center gap-2'>
          {isExpanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
          <h3 className='font-semibold'>{credentialGroupLabel(type, instances.length)}</h3>
          <span className='text-xs tabular-nums text-muted-foreground'>{instances.length}</span>
        </div>
        {/* The rollup summarises the group only while it is collapsed; once expanded, each instance
            row shows its own status, so the group-level icon would be redundant. The locked group
            shows the amber tag instead: its WARNING steps would bucket as a pass icon, and nothing
            in a locked group has been verified (#813). */}
        {!isExpanded &&
          (type === 'Encrypted' ? (
            <span
              className='rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800'
              data-testid='encrypted-group-tag'
            >
              Encrypted
            </span>
          ) : (
            <StatusIcon status={rollup} testId={type} />
          ))}
      </div>
      {isExpanded && (
        <div className='mt-4 space-y-2 pl-6'>
          {instances.map((item) => (
            <CredentialInstanceRow
              key={item.instanceId}
              item={item}
              onRemove={() => onRemove(item)}
              onDecrypted={(credential) => onDecrypted(item, credential)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function CredentialInstanceRow({
  item,
  onRemove,
  onDecrypted,
}: {
  item: CredentialSlot;
  onRemove: () => void;
  onDecrypted: (credential: unknown) => boolean;
}) {
  const stored = item.payload;
  const steps = item.result ?? [];
  const locked = stored.encryptedEnvelope === true;
  // A freshly decrypted row mounts expanded while its pipeline runs, so the decrypt panel is
  // visually replaced by the card body rather than collapsing on the group move (#813).
  const [isExpanded, setIsExpanded] = useState(
    () => stored.decryptedFromEnvelope === true && !credentialIsTerminal(item.result ?? []),
  );
  const title = locked ? 'Encrypted credential' : credentialTitle(stored);
  const status = instanceStatus(item.result);
  // A queued or mid-pipeline instance offers no remove control until its pipeline settles (#810 AC).
  // Removability tracks a terminal result, not the run token, so a freshly queued slot is not
  // briefly removable in the render before its run begins.
  const removable = credentialIsTerminal(steps);
  // A credential queued from a link set's Verify carries its provenance while running (#812);
  // once the pipeline settles it reads like any other instance.
  const subtitle = locked
    ? stored.source?.kind === 'url' && stored.source.via === 'link-set'
      ? 'Awaiting key · from link set'
      : 'Awaiting key'
    : !removable && stored.source?.kind === 'url' && stored.source.via === 'link-set'
      ? 'Verifying... · from link set'
      : credentialSubtitle(stored);

  return (
    <div className='group relative overflow-hidden rounded-md border'>
      <div
        className='flex flex-wrap items-center justify-between gap-2 p-3 cursor-pointer'
        onClick={() => setIsExpanded((prev) => !prev)}
        data-testid='credential-instance-header'
        data-instance-id={item.instanceId}
      >
        <div className='flex min-w-0 items-center gap-2'>
          {isExpanded ? <ChevronDown className='h-4 w-4 shrink-0' /> : <ChevronRight className='h-4 w-4 shrink-0' />}
          <div className='flex min-w-0 flex-col'>
            <h4 className='truncate font-medium'>{title}</h4>
            <span className='truncate text-xs text-gray-500'>{subtitle}</span>
          </div>
        </div>
        {locked ? (
          // The status slot carries the amber Encrypted tag while locked (#813); the icon returns
          // with the pipeline once decryption succeeds.
          <span
            className='rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800'
            data-testid='credential-encrypted-tag'
          >
            Encrypted
          </span>
        ) : (
          <StatusIcon status={status} testId={item.instanceId} />
        )}
      </div>
      {isExpanded && (
        <div className='space-y-2 px-3 pb-3 pl-9'>
          {stored.source && <SourceCaption source={stored.source} />}
          {locked ? (
            <DecryptCredential
              envelope={stored.decoded as unknown as EncryptedCredentialEnvelope}
              onDecrypted={onDecrypted}
            />
          ) : (
            steps.map((step) => <TestStepItem key={step.id} step={step} />)
          )}
        </div>
      )}
      {removable && (
        <button
          type='button'
          aria-label={`Remove ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          // Revealed only when the pointer is over the delete region itself (the right edge), or when
          // the control is keyboard-focused, rather than on hover of the whole row.
          className='absolute bottom-0 right-0 top-0 flex w-12 items-center justify-center bg-red-400 text-white opacity-0 transition-opacity hover:bg-red-500 hover:opacity-100 focus:opacity-100 focus-visible:opacity-100'
        >
          <Trash2 className='h-4 w-4' />
        </button>
      )}
    </div>
  );
}

const TestStepItem = ({ step }: { step: TestStep }) => {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const shouldShowDetails = useMemo(() => {
    return (
      step.details &&
      ((step.details.errors && step.details.errors.length > 0) ||
        (step.details.additionalProperties && Object.keys(step.details.additionalProperties).length > 0))
    );
  }, [step.details]);

  const isAllowedTestCase = [
    TestCaseStepId.UNTP_SCHEMA_VALIDATION,
    TestCaseStepId.EXTENSION_SCHEMA_VALIDATION,
    TestCaseStepId.VCDM_SCHEMA_VALIDATION,
    TestCaseStepId.CONTEXT_VALIDATION,
  ].includes(step.id);

  return (
    <div className='py-2'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <StatusIcon status={step.status} testId={`${step.id}`} />
          <span>{step.name}</span>
        </div>
        {step.details && isAllowedTestCase && shouldShowDetails && (
          <ValidationDetailsSheet
            isOpen={isDetailsOpen}
            onOpenChange={setIsDetailsOpen}
            errors={step.details.errors}
            trigger={
              <Button variant='ghost' size='sm'>
                View Details
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
};
