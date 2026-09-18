import { randomUUID } from 'node:crypto';
import { getRequestContext, isValidCorrelationId, runWithRequestContext } from '@uncefact/untp-ri-services/logging';
import { appLogger } from '@/lib/api/logger';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RequestBodyUnreadableError,
  ServiceInstanceNotFoundError,
  UnprocessableError,
} from '@/lib/api/errors';
import { readBatchJobConcurrency } from '@/lib/config/batch-job-concurrency.config';
import { readBatchBudgetSettings, type CredentialBatchBudgetSettings } from '@/lib/config/credential-batch.config';
import { projectCredentialBatchError } from '@/lib/credentials/credential-batch-error';
import { credentialBatchItemCorrelationId } from '@/lib/credentials/credential-batch-correlation';
import { issueCredentialRequest, type IssueCredentialRequestResult } from '@/lib/credentials/issue-credential-request';
import {
  claimBatchAttempt,
  claimNextBatchItem,
  checkpointBatchContinuation,
  CredentialBatchAttemptFenceLostError,
  getCredentialBatchById,
  markItemFailed,
  markItemIssued,
  markItemOutcomeUnknown,
  markItemQueued,
  recordKnownCredentialId,
  decryptCredentialBatchItemRequest,
  releaseBatchAttempt,
  settleBatchIfFinished,
  type BatchCheckpointOutcome,
  type CredentialBatchWithItems,
} from '@/lib/prisma/repositories/credential-batch.repository';
import { interruptedBatchItemMessage } from '@/lib/credentials/credential-batch-projection';
import { prisma } from '@/lib/prisma/prisma';
import type { Prisma as PrismaTypes } from '@/lib/prisma/generated';
import type { CredentialIssueRequest } from '@/lib/api/request-schemas/credential';
import { ValidationError } from '@/lib/api/validation';
import type { JobContext, JobHandler, JobQueue } from '@/lib/jobs/types';
import { CREDENTIAL_BATCH_ISSUE_JOB } from '@/lib/jobs/queue-names';

const logger = appLogger.child({ module: 'credential-batch-issue-job' });

export type CredentialBatchIssuePayload = {
  batchId: string;
  tenantId: string;
  /** Pins the batch correlation id for re-enqueues outside its request context; the queue stamps the ambient id when absent. */
  correlationId?: string;
};

type Transaction = PrismaTypes.TransactionClient;
type TransactionCallback = <T>(callback: (tx: Transaction) => Promise<T>) => Promise<T>;

export type CredentialBatchIssueDependencies = {
  getBatch: (batchId: string, tenantId: string) => Promise<CredentialBatchWithItems | null>;
  transaction: TransactionCallback;
  claimAttempt: typeof claimBatchAttempt;
  claimNextItem: typeof claimNextBatchItem;
  issue: (input: {
    tenantId: string;
    body: CredentialIssueRequest;
    onDispatch: () => void;
  }) => Promise<IssueCredentialRequestResult>;
  decryptRequest: (request: string) => CredentialIssueRequest;
  markIssued: typeof markItemIssued;
  markFailed: typeof markItemFailed;
  markOutcomeUnknown: typeof markItemOutcomeUnknown;
  markQueued: typeof markItemQueued;
  recordKnownCredentialId: typeof recordKnownCredentialId;
  releaseAttempt: typeof releaseBatchAttempt;
  settle: typeof settleBatchIfFinished;
  checkpoint: typeof checkpointBatchContinuation;
  now: () => Date;
  queue: JobQueue;
};

function averageItemCostMs(costs: readonly number[], minimumItemCostMs: number): number {
  if (costs.length === 0) return minimumItemCostMs;
  return Math.max(minimumItemCostMs, costs.reduce((total, cost) => total + cost, 0) / costs.length);
}

function remainingBudgetMs(context: JobContext, startedAt: Date, now: Date, settlementAllowanceMs: number): number {
  return context.expireSeconds * 1_000 - settlementAllowanceMs - (now.getTime() - startedAt.getTime());
}

function batchLogFields(batch: CredentialBatchWithItems) {
  return {
    correlationId: batch.correlationId,
    batchCorrelationId: batch.correlationId,
    batchId: batch.id,
    tenantId: batch.tenantId,
  };
}

function itemLogFields(batch: CredentialBatchWithItems, index: number, itemCorrelationId: string) {
  return {
    correlationId: itemCorrelationId,
    batchCorrelationId: batch.correlationId,
    batchId: batch.id,
    tenantId: batch.tenantId,
    index,
  };
}

function missingBatchLogFields(payload: CredentialBatchIssuePayload) {
  return { correlationId: getRequestContext()?.correlationId ?? null, batchId: payload.batchId, tenantId: payload.tenantId };
}

async function handleCheckpointOutcome(
  deps: CredentialBatchIssueDependencies,
  batch: CredentialBatchWithItems,
  payload: CredentialBatchIssuePayload,
  token: string,
  checkpoint: BatchCheckpointOutcome,
  startAfter?: Date,
): Promise<void> {
  const fields = batchLogFields(batch);
  if (checkpoint.outcome === 'checkpointed') {
    logger.info(
      { ...fields, checkpointed: true, ...(startAfter === undefined ? {} : { startAfter }) },
      startAfter === undefined
        ? 'Credential batch continuation checkpointed'
        : 'Credential batch deferred continuation checkpointed',
    );
    return;
  }
  if (checkpoint.outcome === 'superseded') {
    logger.info({ ...fields, outcome: checkpoint.outcome }, 'Credential batch checkpoint stopped');
    return;
  }
  if (checkpoint.outcome === 'applied') {
    logger.info({ ...fields, settlement: checkpoint.outcome }, 'Credential batch cancellation checked');
    return;
  }

  logger.warn(
    { ...fields, settlement: checkpoint.outcome },
    'Credential batch cancellation could not settle',
  );
  const released = await deps.transaction((tx) =>
    deps.releaseAttempt(tx, {
      batchId: payload.batchId,
      tenantId: payload.tenantId,
      token,
    }),
  );
  if (!released.applied) {
    logger.warn(
      { ...fields, settlement: checkpoint.outcome },
      'Credential batch cancellation settlement could not release the fence held by this worker',
    );
  }
}

/**
 * Only request-side errors are definitive item refusals. Adapter ServiceErrors,
 * even when they carry a 4xx status such as 408 or 429, leave the external
 * issuance outcome uncertain and must fault the batch for retry or recovery.
 * Database errors and all other errors are faults as well.
 */
function refusalOutcome(error: unknown, itemCorrelationId: string): { code: string; message: string } | undefined {
  if (
    !(
      error instanceof ValidationError ||
      error instanceof UnprocessableError ||
      error instanceof ForbiddenError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError ||
      error instanceof PayloadTooLargeError ||
      error instanceof RequestBodyUnreadableError ||
      error instanceof ServiceInstanceNotFoundError
    )
  ) {
    return undefined;
  }
  const projected = projectCredentialBatchError(error, itemCorrelationId);
  return { code: projected.code ?? 'REFUSED', message: projected.message };
}

function throwIfAborted(context: JobContext): void {
  // Cancellation is observed between items only. The current issuance must
  // finish its external effect before the next item boundary is considered.
  if (context.signal.aborted) {
    throw context.signal.reason instanceof Error ? context.signal.reason : new Error('Credential batch job aborted');
  }
}

export function defaultCredentialBatchIssueDependencies(queue: JobQueue): CredentialBatchIssueDependencies {
  return {
    getBatch: getCredentialBatchById,
    transaction: (callback) => prisma.$transaction(callback, { maxWait: 5_000, timeout: 15_000 }),
    claimAttempt: claimBatchAttempt,
    claimNextItem: claimNextBatchItem,
    issue: ({ tenantId, body, onDispatch }) => issueCredentialRequest({ tenantId, body, onDispatch }),
    decryptRequest: (request) => JSON.parse(decryptCredentialBatchItemRequest(request)) as CredentialIssueRequest,
    markIssued: markItemIssued,
    markFailed: markItemFailed,
    markOutcomeUnknown: markItemOutcomeUnknown,
    markQueued: markItemQueued,
    recordKnownCredentialId,
    releaseAttempt: releaseBatchAttempt,
    settle: settleBatchIfFinished,
    checkpoint: checkpointBatchContinuation,
    now: () => new Date(Date.now()),
    queue,
  };
}

export function credentialBatchIssueHandler(
  deps: CredentialBatchIssueDependencies,
  budget: CredentialBatchBudgetSettings = readBatchBudgetSettings(),
): JobHandler<CredentialBatchIssuePayload> {
  return async (payload, context) => {
    const startedAt = deps.now();
    const batch = await deps.getBatch(payload.batchId, payload.tenantId);
    if (batch === null) {
      logger.warn(missingBatchLogFields(payload), 'Credential batch job found no tenant-owned batch');
      return;
    }
    return runWithRequestContext(batch.correlationId, async () => {
      if (batch.settledAt !== null) {
        logger.info({ ...batchLogFields(batch), state: batch.state }, 'Credential batch job found a settled batch');
        return;
      }

      const token = randomUUID();
      const staleBefore = new Date(deps.now().getTime() - context.expireSeconds * 1_000);
      let attempt: Awaited<ReturnType<typeof claimBatchAttempt>>;
      try {
        attempt = await deps.transaction((tx) =>
          deps.claimAttempt(tx, {
            batchId: payload.batchId,
            tenantId: payload.tenantId,
            token,
            expectedVersion: batch.version,
            staleBefore,
          }),
        );
      } catch (error) {
        if (error instanceof CredentialBatchAttemptFenceLostError) {
          logger.warn(
            {
              ...batchLogFields(batch),
              attemptStartedAt: batch.attemptStartedAt,
              lastProgressAt: batch.lastProgressAt,
            },
            'Credential batch job did not acquire the current ownership fence',
          );
          return;
        }
        throw error;
      }
      if (!attempt.applied) {
        logger.warn(
          {
            ...batchLogFields(batch),
            attemptStartedAt: batch.attemptStartedAt,
            lastProgressAt: batch.lastProgressAt,
          },
          'Credential batch job did not acquire the current ownership fence',
        );
        return;
      }

      const costs: number[] = [];
      let itemsAttempted = 0;
      let entryBudgetChecked = false;
      for (;;) {
        try {
          throwIfAborted(context);
        } catch (error) {
          const released = await deps.transaction((tx) =>
            deps.releaseAttempt(tx, {
              batchId: payload.batchId,
              tenantId: payload.tenantId,
              token,
            }),
          );
          if (!released.applied) {
            logger.warn(
              { ...batchLogFields(batch), token },
              'Credential batch cancellation could not release its ownership fence',
            );
          }
          throw error;
        }
        const remainingBudget = remainingBudgetMs(context, startedAt, deps.now(), budget.settlementAllowanceMs);
        if (!entryBudgetChecked) {
          entryBudgetChecked = true;
          if (remainingBudget <= 0) {
            logger.warn(
              {
                ...batchLogFields(batch),
                expireSeconds: context.expireSeconds,
                settlementAllowanceMs: budget.settlementAllowanceMs,
                minimumItemCostMs: budget.minimumItemCostMs,
                remainingBudgetMs: remainingBudget,
              },
              'Credential batch job entered with an exhausted pre-item budget; the first item will still be attempted',
            );
          }
        }
        if (itemsAttempted > 0 && remainingBudget < averageItemCostMs(costs, budget.minimumItemCostMs)) {
          const checkpoint = await deps.transaction((tx) =>
            deps.checkpoint(tx, {
              batchId: payload.batchId,
              tenantId: payload.tenantId,
              token,
              correlationId: batch.correlationId,
              queue: deps.queue,
            }),
          );
          await handleCheckpointOutcome(deps, batch, payload, token, checkpoint);
          return;
        }

        const claimed = await deps.transaction((tx) =>
          deps.claimNextItem(tx, { batchId: payload.batchId, tenantId: payload.tenantId, token }),
        );
        if (claimed.outcome === 'empty') {
          if (claimed.nextAttemptAt !== undefined) {
            const now = deps.now();
            const startAfter = new Date(Math.max(claimed.nextAttemptAt.getTime(), now.getTime() + 1_000));
            const checkpoint = await deps.transaction((tx) =>
              deps.checkpoint(tx, {
                batchId: payload.batchId,
                tenantId: payload.tenantId,
                token,
                correlationId: batch.correlationId,
                queue: deps.queue,
                startAfter,
              }),
            );
            await handleCheckpointOutcome(deps, batch, payload, token, checkpoint, startAfter);
            return;
          }
          const settlement = await deps.transaction((tx) =>
            deps.settle(tx, { batchId: payload.batchId, tenantId: payload.tenantId, token }),
          );
          logger.info(
            { ...batchLogFields(batch), settlement: settlement.outcome },
            'Credential batch settlement checked',
          );
          return;
        }
        if (claimed.outcome === 'cancelled') {
          const settlement = await deps.transaction((tx) =>
            deps.settle(tx, { batchId: payload.batchId, tenantId: payload.tenantId, token }),
          );
          if (settlement.outcome === 'applied') {
            logger.info(
              { ...batchLogFields(batch), settlement: settlement.outcome },
              'Credential batch cancellation checked',
            );
          } else if (settlement.outcome === 'already-settled') {
            logger.info(
              { ...logFields(payload), settlement: settlement.outcome },
              'Credential batch cancellation already settled',
            );
          } else {
            logger.warn(
              { ...batchLogFields(batch), settlement: settlement.outcome },
              'Credential batch cancellation could not settle',
            );
            const released = await deps.transaction((tx) =>
              deps.releaseAttempt(tx, {
                batchId: payload.batchId,
                tenantId: payload.tenantId,
                token,
              }),
            );
            if (!released.applied) {
              logger.warn(
                { ...batchLogFields(batch), settlement: settlement.outcome },
                'Credential batch cancellation settlement in the claim branch could not release the fence this worker holds',
              );
            }
          }
        } else if (claimed.outcome !== 'claimed') {
          const level = claimed.outcome === 'missing' ? 'warn' : 'info';
          logger[level]({ ...batchLogFields(batch), outcome: claimed.outcome }, 'Credential batch claim stopped');
        }
        return;
      }

        const { index, request } = claimed.item;
        itemsAttempted += 1;
        const derivedItemCorrelationId = credentialBatchItemCorrelationId(batch.correlationId, index);
        const itemCorrelationId = isValidCorrelationId(derivedItemCorrelationId)
          ? derivedItemCorrelationId
          : randomUUID();
        if (itemCorrelationId !== derivedItemCorrelationId) {
          logger.warn(
            {
              batchCorrelationId: batch.correlationId,
              index,
              rejectedCorrelationId: derivedItemCorrelationId,
              mintedCorrelationId: itemCorrelationId,
            },
            'Credential batch item correlation id was invalid; minted a replacement',
          );
        }
        const shouldStop = await runWithRequestContext(itemCorrelationId, async () => {
          const itemStartedAt = deps.now();
          let issueDispatched = false;
          let issuedCredentialId: string | undefined;
          try {
            const body = deps.decryptRequest(request);
            const result = await deps.issue({
              tenantId: payload.tenantId,
              body,
              onDispatch: () => {
                issueDispatched = true;
              },
            });
            issuedCredentialId = result.body.credentialId;
            const duration = deps.now().getTime() - itemStartedAt.getTime();
            costs.push(duration);
            const warnings =
              result.body.warnings && result.body.warnings.length > 0
                ? (JSON.parse(JSON.stringify(result.body.warnings)) as PrismaTypes.JsonValue)
                : null;
            const outcome = await deps.transaction((tx) =>
              deps.markIssued(tx, {
                batchId: payload.batchId,
                tenantId: payload.tenantId,
                index,
                token,
                credentialId: result.body.credentialId,
                warning: warnings,
              }),
            );
            if (outcome.outcome !== 'applied') {
              logger.warn(
                { ...itemLogFields(batch, index, itemCorrelationId), credentialId: result.body.credentialId },
                `issued credential ${result.body.credentialId} could not be recorded on item ${index}: ownership fence lost; check the library`,
              );
              try {
                const recorded = await deps.transaction((tx) =>
                  deps.recordKnownCredentialId(tx, {
                    batchId: payload.batchId,
                    tenantId: payload.tenantId,
                    index,
                    credentialId: result.body.credentialId,
                  }),
                );
                if (!recorded.applied) {
                  logger.warn(
                    { ...itemLogFields(batch, index, itemCorrelationId), credentialId: result.body.credentialId },
                    'Issued credential id could not be added because the item is not yet outcome unknown',
                  );
                }
              } catch (recordError) {
                logger.warn(
                  {
                    ...itemLogFields(batch, index, itemCorrelationId),
                    credentialId: result.body.credentialId,
                    err: recordError,
                  },
                  'Failed to record the known credential id after the ownership fence was lost',
                );
              }
              return true;
            }
            logger.info(
              {
                ...itemLogFields(batch, index, itemCorrelationId),
                state: 'ISSUED',
                credentialId: result.body.credentialId,
              },
              'Credential batch item processed',
            );
          } catch (error) {
            if (issueDispatched) {
              try {
                const resolution = await deps.transaction(async (tx) => {
                  const item = await deps.markOutcomeUnknown(tx, {
                    batchId: payload.batchId,
                    tenantId: payload.tenantId,
                    index,
                    token,
                    errorClass: 'OUTCOME_UNKNOWN',
                    errorMessage: interruptedBatchItemMessage({ itemCorrelationId }),
                    ...(issuedCredentialId === undefined ? {} : { credentialId: issuedCredentialId }),
                  });
                  const settlement = await deps.settle(tx, {
                    batchId: payload.batchId,
                    tenantId: payload.tenantId,
                    token,
                  });
                  if (settlement.outcome === 'applied') return { item, released: null };
                  const released = await deps.releaseAttempt(tx, {
                    batchId: payload.batchId,
                    tenantId: payload.tenantId,
                    token,
                  });
                  return { item, released };
                });
                if (resolution.item.outcome !== 'applied') {
                  logger.warn(
                    {
                      ...itemLogFields(batch, index, itemCorrelationId),
                      itemOutcome: resolution.item.outcome,
                      issueDispatched,
                    },
                    'Credential batch fault item transition was superseded',
                  );
                }
                if (resolution.released !== null && !resolution.released.applied) {
                  logger.warn(
                    { ...itemLogFields(batch, index, itemCorrelationId), token },
                    'Credential batch fault could not release its ownership fence',
                  );
                }
              } catch (releaseError) {
                logger.warn(
                  { ...itemLogFields(batch, index, itemCorrelationId), err: releaseError },
                  'Failed to release credential batch ownership fence after fault',
                );
              }
              logger.error(
                { ...itemLogFields(batch, index, itemCorrelationId), err: error, fault: true },
                'Credential batch item outcome is unknown; pg-boss will retry the job',
              );
              throw error;
            }
            const refusal = refusalOutcome(error, itemCorrelationId);
            if (refusal === undefined) {
              costs.push(deps.now().getTime() - itemStartedAt.getTime());
              const fault = projectCredentialBatchError(error, itemCorrelationId);
              try {
                const item = await deps.transaction((tx) =>
                  deps.markQueued(tx, {
                    batchId: payload.batchId,
                    tenantId: payload.tenantId,
                    index,
                    token,
                    errorMessage: fault.message,
                  }),
                );
                if (item.outcome === 'attempts-exhausted') {
                  logger.error(
                    {
                      ...itemLogFields(batch, index, itemCorrelationId),
                      errorCode: 'ITEM_ATTEMPTS_EXHAUSTED',
                      err: error,
                      fault: true,
                    },
                    'Credential batch item reached its retry limit and was marked failed',
                  );
                  return false;
                }
                if (item.outcome !== 'applied') {
                  logger.warn(
                    {
                      ...itemLogFields(batch, index, itemCorrelationId),
                      itemOutcome: item.outcome,
                      issueDispatched: false,
                    },
                    'Credential batch fault item transition was superseded',
                  );
                }
              } catch (transitionError) {
                try {
                  const released = await deps.transaction((tx) =>
                    deps.releaseAttempt(tx, {
                      batchId: payload.batchId,
                      tenantId: payload.tenantId,
                      token,
                    }),
                  );
                  if (!released.applied) {
                    logger.warn(
                      { ...itemLogFields(batch, index, itemCorrelationId), token },
                      'Credential batch fault could not release its ownership fence',
                    );
                  }
                } catch (releaseError) {
                  logger.warn(
                    { ...itemLogFields(batch, index, itemCorrelationId), err: releaseError },
                    'Failed to release credential batch ownership fence after fault transition failure',
                  );
                }
                logger.warn(
                  { ...itemLogFields(batch, index, itemCorrelationId), err: transitionError },
                  'Credential batch item fault transition failed',
                );
                throw transitionError;
              }
              logger.error(
                { ...itemLogFields(batch, index, itemCorrelationId), err: error, fault: true },
                'Credential batch item faulted; continuing with the next claimable item',
              );
              return false;
            }
            costs.push(deps.now().getTime() - itemStartedAt.getTime());
            const outcome = await deps.transaction((tx) =>
              deps.markFailed(tx, {
                batchId: payload.batchId,
                tenantId: payload.tenantId,
                index,
                token,
                errorClass: refusal.code,
                errorMessage: refusal.message,
              }),
            );
            logger.warn(
              {
                ...itemLogFields(batch, index, itemCorrelationId),
                state: 'FAILED',
                errorCode: refusal.code,
                transitioned: outcome.outcome === 'applied',
              },
              'Credential batch item refused',
            );
          }
          return false;
        });
        if (shouldStop) return;
      }
    });
  };
}

/** Registers sequential item processing; the setting controls parallel batches, never item order. */
export function registerCredentialBatchIssue(
  queue: JobQueue,
  deps: CredentialBatchIssueDependencies = defaultCredentialBatchIssueDependencies(queue),
  concurrency = readBatchJobConcurrency(),
  budget: CredentialBatchBudgetSettings = readBatchBudgetSettings(),
): void {
  queue.register(CREDENTIAL_BATCH_ISSUE_JOB, credentialBatchIssueHandler(deps, budget), { concurrency });
}
