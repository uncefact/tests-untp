import { EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import { getOrMintCorrelationId, getRequestContext, isValidCorrelationId } from '@uncefact/untp-ri-services/logging';
import { Prisma } from '../generated';
import type { Prisma as PrismaTypes } from '../generated';
import { CredentialBatchItemState, CredentialBatchState } from '../generated';
import { prisma } from '../prisma';
import { isUniqueConstraintViolation } from '../db-errors';
import { getEncryptionService } from '@/lib/encryption/encryption';
import {
  credentialBatchItemAttemptLimit,
  credentialBatchItemBackoffSeconds,
  getCredentialBatchIssueEnqueueOptions,
  readBatchRetentionDays,
} from '@/lib/config/credential-batch.config';
import {
  interruptedBatchItemMessage,
  OPERATOR_CONFIRMED_FAILURE_CODE,
} from '@/lib/credentials/credential-batch-projection';
import { credentialBatchItemCorrelationId } from '@/lib/credentials/credential-batch-correlation';
import type { CredentialBatchItemRequest } from '@/lib/api/request-schemas/credential-batch';
import { prismaSqlExecutor } from '@/lib/jobs/prisma-sql-executor';
import type { JobQueue } from '@/lib/jobs/types';
import { CREDENTIAL_BATCH_ISSUE_JOB } from '@/lib/jobs/queue-names';

const BATCH_WITH_ITEMS_INCLUDE = {
  items: { orderBy: { index: 'asc' as const } },
} as const;

export type CredentialBatchWithItems = Prisma.CredentialBatchGetPayload<{
  include: typeof BATCH_WITH_ITEMS_INCLUDE;
}>;
export type CredentialBatchSummary = Prisma.CredentialBatchGetPayload<{
  select: {
    id: true;
    tenantId: true;
    state: true;
    itemCount: true;
    queuedCount: true;
    processingCount: true;
    issuedCount: true;
    failedCount: true;
    unknownCount: true;
    cancelledCount: true;
    cancelRequestedAt: true;
    idempotencyKey: true;
    bodyDigest: true;
    createdAt: true;
    settledAt: true;
    expiresAt: true;
    attemptToken: true;
    attemptStartedAt: true;
    version: true;
    lastProgressAt: true;
  };
}>;

type CreateCredentialBatchInput = {
  tenantId: string;
  idempotencyKey: string;
  bodyDigest: string;
  items: readonly CredentialBatchItemRequest[];
  queue: JobQueue;
};

export type BatchSubmissionResult =
  | { outcome: 'created'; batchId: string }
  | { outcome: 'replay'; batchId: string }
  | { outcome: 'expired'; batchId: string }
  | { outcome: 'mismatch' };

export type BatchMutationOutcome =
  | { outcome: 'applied' }
  | { outcome: 'attempts-exhausted' }
  | { outcome: 'missing' }
  | { outcome: 'superseded' };

export type BatchSettlementOutcome =
  | { outcome: 'applied'; state: CredentialBatchState }
  | { outcome: 'missing' }
  | { outcome: 'not-ready' }
  | { outcome: 'superseded' }
  | { outcome: 'already-settled' };

type CredentialBatchResolutionBatch = {
  state: CredentialBatchState;
  itemCount: number;
  queuedCount: number;
  processingCount: number;
  issuedCount: number;
  failedCount: number;
  unknownCount: number;
  cancelledCount: number;
  version: number;
  createdAt: Date;
  settledAt: Date | null;
  resolvedAt: Date | null;
  expiresAt: Date | null;
};

type CredentialBatchResolutionItem = {
  state: CredentialBatchItemState;
  credentialId: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  updatedAt: Date;
};

export type CredentialBatchResolutionSnapshot = {
  batchState: CredentialBatchState;
  batchVersion: number;
  counts: {
    total: number;
    queued: number;
    processing: number;
    issued: number;
    failed: number;
    unknown: number;
    cancelled: number;
  };
  itemState: CredentialBatchItemState | null;
  credentialId: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  createdAt: Date | null;
  settledAt: Date | null;
  resolvedAt: Date | null;
  expiresAt: Date | null;
  itemUpdatedAt: Date | null;
};

export type ResolveUnknownBatchItemInput = {
  tenantId: string;
  batchId: string;
  index: number;
  expectedVersion: number;
  resolution: { state: 'ISSUED'; credentialId: string } | { state: 'FAILED'; evidence: string };
  reason: string;
};

export type CredentialBatchResolutionAudit = {
  action: 'resolve';
  tenantId: string;
  batchId: string;
  index: number;
  version: number;
  resolution: 'ISSUED' | 'FAILED';
  reason: string;
  credentialId?: string;
  evidence?: string;
};

export type ResolveUnknownBatchItemResult =
  | {
      outcome: 'applied';
      audit: CredentialBatchResolutionAudit;
      before: CredentialBatchResolutionSnapshot;
      after: CredentialBatchResolutionSnapshot;
    }
  | {
      outcome:
        | 'missing'
        | 'not-settled'
        | 'version-mismatch'
        | 'item-missing'
        | 'not-unknown'
        | 'credential-recorded'
        | 'reason-missing'
        | 'credential-not-found'
        | 'evidence-missing';
      audit: CredentialBatchResolutionAudit;
      before?: CredentialBatchResolutionSnapshot;
    };

export type CredentialBatchItemInspection = {
  tenantId: string;
  batchId: string;
  batchCorrelationId: string;
  itemCorrelationId: string;
  index: number;
  batchState: CredentialBatchState;
  batchVersion: number;
  requestDigest: string;
  createdAt: Date;
  settledAt: Date | null;
  resolvedAt: Date | null;
  itemState: CredentialBatchItemState;
  itemUpdatedAt: Date;
  credentialId: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  resolutionReason: string | null;
  itemResolvedAt: Date | null;
  reference: string | null;
  encryptedRequest: string;
};

function encryptRequest(request: unknown): string {
  return JSON.stringify(getEncryptionService().encrypt(JSON.stringify(request), EncryptionAlgorithm.AES_256_GCM));
}

/** Reads one batch request through the same DEK and envelope service as the worker. */
export function decryptCredentialBatchItemRequest(request: string): string {
  return getEncryptionService().decrypt(JSON.parse(request));
}

export function classifySubmission(
  batch: Pick<CredentialBatchSummary, 'id' | 'state' | 'bodyDigest'>,
  bodyDigest: string,
) {
  if (batch.state === CredentialBatchState.EXPIRED) return { outcome: 'expired' as const, batchId: batch.id };
  if (batch.bodyDigest !== bodyDigest) return { outcome: 'mismatch' as const };
  return { outcome: 'replay' as const, batchId: batch.id };
}

/** Looks up a batch's own submission idempotency record without reading items. */
export async function findCredentialBatchSubmission(
  tenantId: string,
  idempotencyKey: string,
): Promise<CredentialBatchSummary | null> {
  return prisma.credentialBatch.findFirst({
    where: { tenantId, idempotencyKey },
    select: {
      id: true,
      tenantId: true,
      state: true,
      itemCount: true,
      queuedCount: true,
      processingCount: true,
      issuedCount: true,
      failedCount: true,
      unknownCount: true,
      cancelledCount: true,
      cancelRequestedAt: true,
      idempotencyKey: true,
      bodyDigest: true,
      createdAt: true,
      settledAt: true,
      expiresAt: true,
      attemptToken: true,
      attemptStartedAt: true,
      version: true,
      lastProgressAt: true,
    },
  });
}

/**
 * Inserts the batch, encrypted item requests and queue row in one transaction.
 * A unique-key race is classified after its transaction rolls back, so only
 * the committed winner is ever replayed.
 */
export async function createCredentialBatch(input: CreateCredentialBatchInput): Promise<BatchSubmissionResult> {
  const correlationId = getRequestContext()?.correlationId ?? getOrMintCorrelationId();
  const encryptedItems = input.items.map(({ reference, ...request }) => ({
    reference: reference ?? null,
    request: encryptRequest(request),
  }));
  try {
    const batch = await prisma.$transaction(
      async (tx) => {
        const created = await tx.credentialBatch.create({
          data: {
            tenantId: input.tenantId,
            correlationId,
            state: CredentialBatchState.QUEUED,
            itemCount: input.items.length,
            queuedCount: input.items.length,
            idempotencyKey: input.idempotencyKey,
            bodyDigest: input.bodyDigest,
          },
        });

        await tx.credentialBatchItem.createMany({
          data: encryptedItems.map(({ reference, request }, index) => ({
            batchId: created.id,
            tenantId: input.tenantId,
            index,
            state: CredentialBatchItemState.QUEUED,
            reference,
            request,
          })),
        });

        await input.queue.enqueueWithin(
          prismaSqlExecutor(tx),
          CREDENTIAL_BATCH_ISSUE_JOB,
          { batchId: created.id, tenantId: input.tenantId },
          getCredentialBatchIssueEnqueueOptions(),
        );
        return created;
      },
      // Match the 15 s transaction budget and 5 s pool wait used by larger writes in
      // src/lib/prisma/repositories/external-credential.repository.ts.
      { maxWait: 5_000, timeout: 15_000 },
    );
    return { outcome: 'created', batchId: batch.id };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const winner = await findCredentialBatchSubmission(input.tenantId, input.idempotencyKey);
    // The reference unique index is a backstop unreachable behind the route's duplicate check, so a hit is rethrown as unexpected.
    if (!winner) throw error;
    return classifySubmission(winner, input.bodyDigest);
  }
}

/** Returns the tenant-owned batch and its items in submission order. */
export async function getCredentialBatchById(
  batchId: string,
  tenantId: string,
): Promise<CredentialBatchWithItems | null> {
  return prisma.credentialBatch.findFirst({
    where: { id: batchId, tenantId },
    include: BATCH_WITH_ITEMS_INCLUDE,
  });
}

/** The caller must keep this lock until all dependent item and counter writes commit (ADR-060). */
async function lockCredentialBatchForUpdate(tx: PrismaTypes.TransactionClient, batchId: string, tenantId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "CredentialBatch"
    WHERE "id" = ${batchId} AND "tenantId" = ${tenantId}
    FOR UPDATE
  `;
  if (rows.length === 0) return null;
  return tx.credentialBatch.findFirst({ where: { id: batchId, tenantId } });
}

export type CancelCredentialBatchResult =
  | { outcome: 'missing' }
  | { outcome: 'expired' | 'not-cancellable' | 'already-requested' | 'applied'; batch: CredentialBatchWithItems };

/** Classifies terminal states before active retries, as required by #1080. */
export function classifyBatchCancellation(
  batch: Pick<CredentialBatchSummary, 'state' | 'cancelRequestedAt'>,
): 'expired' | 'not-cancellable' | 'already-requested' | 'cancellable' {
  if (batch.state === CredentialBatchState.EXPIRED) return 'expired';
  if (batch.state !== CredentialBatchState.QUEUED && batch.state !== CredentialBatchState.RUNNING) {
    return 'not-cancellable';
  }
  return batch.cancelRequestedAt === null ? 'cancellable' : 'already-requested';
}

/**
 * Cancels queued items, including deferred retries, in the caller's transaction (#1080).
 * Processing items keep their attempt. Rejected and repeated requests leave rows unchanged.
 * Database failures must roll back the transaction, including item and counter changes.
 */
export async function cancelCredentialBatch(
  tx: PrismaTypes.TransactionClient,
  input: { batchId: string; tenantId: string },
): Promise<CancelCredentialBatchResult> {
  const batch = await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  if (batch === null) return { outcome: 'missing' };
  const classification = classifyBatchCancellation(batch);
  if (classification !== 'cancellable') {
    const view = await tx.credentialBatch.findFirstOrThrow({
      where: { id: input.batchId, tenantId: input.tenantId },
      include: BATCH_WITH_ITEMS_INCLUDE,
    });
    return { outcome: classification, batch: view };
  }
  const now = new Date(Date.now());
  const cancelled = await tx.credentialBatchItem.updateMany({
    where: { batchId: input.batchId, tenantId: input.tenantId, state: CredentialBatchItemState.QUEUED },
    data: { state: CredentialBatchItemState.CANCELLED, attemptToken: null, nextAttemptAt: null },
  });
  if (cancelled.count !== batch.queuedCount)
    throw new Error('Credential batch queued items disagree with its counters');
  const updated = await tx.credentialBatch.update({
    where: { id: input.batchId, tenantId: input.tenantId },
    data: {
      cancelRequestedAt: now,
      queuedCount: { decrement: cancelled.count },
      cancelledCount: { increment: cancelled.count },
      version: { increment: 1 },
    },
  });
  if (updated.processingCount === 0) await settleLockedBatch(tx, updated, updated.attemptToken);
  return {
    outcome: 'applied',
    batch: await tx.credentialBatch.findFirstOrThrow({
      where: { id: input.batchId, tenantId: input.tenantId },
      include: BATCH_WITH_ITEMS_INCLUDE,
    }),
  };
}

/** Reads one tenant-owned item for the audited maintenance inspection command. */
export async function getCredentialBatchItemForInspection(
  batchId: string,
  tenantId: string,
  index: number,
): Promise<CredentialBatchItemInspection | null> {
  const batch = await prisma.credentialBatch.findFirst({
    where: { id: batchId, tenantId },
    select: {
      id: true,
      tenantId: true,
      correlationId: true,
      state: true,
      bodyDigest: true,
      createdAt: true,
      settledAt: true,
      resolvedAt: true,
      version: true,
      items: {
        where: { index },
        take: 1,
        select: {
          index: true,
          state: true,
          credentialId: true,
          errorClass: true,
          errorMessage: true,
          resolutionReason: true,
          resolvedAt: true,
          updatedAt: true,
          reference: true,
          request: true,
        },
      },
    },
  });
  const item = batch?.items[0];
  if (batch === null || item === undefined) return null;
  const derivedItemCorrelationId = credentialBatchItemCorrelationId(batch.correlationId, item.index);
  return {
    tenantId: batch.tenantId,
    batchId: batch.id,
    batchCorrelationId: batch.correlationId,
    itemCorrelationId: isValidCorrelationId(derivedItemCorrelationId)
      ? derivedItemCorrelationId
      : '(not derivable; search by batchCorrelationId and index)',
    index: item.index,
    batchState: batch.state,
    batchVersion: batch.version,
    requestDigest: batch.bodyDigest,
    createdAt: batch.createdAt,
    settledAt: batch.settledAt,
    resolvedAt: batch.resolvedAt,
    itemState: item.state,
    itemUpdatedAt: item.updatedAt,
    credentialId: item.credentialId,
    errorClass: item.errorClass,
    errorMessage: item.errorMessage,
    resolutionReason: item.resolutionReason,
    itemResolvedAt: item.resolvedAt,
    reference: item.reference,
    encryptedRequest: item.request,
  };
}

export function buildCredentialBatchResolutionAudit(
  input: ResolveUnknownBatchItemInput,
): CredentialBatchResolutionAudit {
  return {
    action: 'resolve',
    tenantId: input.tenantId,
    batchId: input.batchId,
    index: input.index,
    version: input.expectedVersion,
    resolution: input.resolution.state,
    reason: input.reason.trim(),
    ...(input.resolution.state === 'ISSUED'
      ? { credentialId: input.resolution.credentialId }
      : { evidence: input.resolution.evidence }),
  };
}

function resolutionSnapshot(
  batch: CredentialBatchResolutionBatch | null,
  item: CredentialBatchResolutionItem | null,
): CredentialBatchResolutionSnapshot {
  return {
    batchState: batch?.state ?? CredentialBatchState.EXPIRED,
    batchVersion: batch?.version ?? -1,
    counts: {
      total: batch?.itemCount ?? 0,
      queued: batch?.queuedCount ?? 0,
      processing: batch?.processingCount ?? 0,
      issued: batch?.issuedCount ?? 0,
      failed: batch?.failedCount ?? 0,
      unknown: batch?.unknownCount ?? 0,
      cancelled: batch?.cancelledCount ?? 0,
    },
    itemState: item?.state ?? null,
    credentialId: item?.credentialId ?? null,
    errorClass: item?.errorClass ?? null,
    errorMessage: item?.errorMessage ?? null,
    createdAt: batch?.createdAt ?? null,
    settledAt: batch?.settledAt ?? null,
    resolvedAt: batch?.resolvedAt ?? null,
    expiresAt: batch?.expiresAt ?? null,
    itemUpdatedAt: item?.updatedAt ?? null,
  };
}

/** Resolves one unknown item without enqueueing work or weakening the batch version fence. */
export async function resolveUnknownBatchItem(
  tx: PrismaTypes.TransactionClient,
  input: ResolveUnknownBatchItemInput,
): Promise<ResolveUnknownBatchItemResult> {
  const audit = buildCredentialBatchResolutionAudit(input);
  const batch = await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  if (batch === null) return { outcome: 'missing', audit };

  const item = await tx.credentialBatchItem.findFirst({
    where: { batchId: input.batchId, tenantId: input.tenantId, index: input.index },
    select: { state: true, credentialId: true, errorClass: true, errorMessage: true, updatedAt: true },
  });
  const before = resolutionSnapshot(batch, item);
  if (batch.settledAt !== null && item !== null && item.state !== CredentialBatchItemState.OUTCOME_UNKNOWN) {
    return { outcome: 'not-unknown', audit, before };
  }
  if (batch.state !== CredentialBatchState.NEEDS_ATTENTION || batch.settledAt === null) {
    return { outcome: 'not-settled', audit, before };
  }
  if (batch.version !== input.expectedVersion) return { outcome: 'version-mismatch', audit, before };
  if (item === null) return { outcome: 'item-missing', audit, before };
  if (item.state !== CredentialBatchItemState.OUTCOME_UNKNOWN) return { outcome: 'not-unknown', audit, before };
  if (input.resolution.state === 'FAILED' && item.credentialId !== null) {
    return { outcome: 'credential-recorded', audit, before };
  }
  if (
    input.resolution.state === 'ISSUED' &&
    item.credentialId !== null &&
    input.resolution.credentialId !== item.credentialId
  ) {
    return { outcome: 'credential-recorded', audit, before };
  }
  if (input.reason.trim() === '') return { outcome: 'reason-missing', audit, before };

  const issuedCredentialId =
    input.resolution.state === 'ISSUED' ? item.credentialId ?? input.resolution.credentialId : null;

  if (input.resolution.state === 'ISSUED') {
    const credential = await tx.credential.findFirst({
      where: { id: input.resolution.credentialId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (credential === null) return { outcome: 'credential-not-found', audit, before };
  } else if (input.resolution.evidence.trim() === '') {
    return { outcome: 'evidence-missing', audit, before };
  }

  const now = new Date(Date.now());
  const lastUnknown = batch.unknownCount === 1;
  const nextState = settledBatchState(lastUnknown ? 0 : batch.unknownCount - 1, batch.cancelledCount);
  const nextExpiresAt = lastUnknown ? new Date(now.getTime() + readBatchRetentionDays() * 24 * 60 * 60 * 1_000) : null;
  const updatedBatch = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      state: CredentialBatchState.NEEDS_ATTENTION,
      settledAt: { not: null },
      version: input.expectedVersion,
      unknownCount: { gt: 0 },
    },
    data: {
      state: nextState,
      unknownCount: { decrement: 1 },
      ...(input.resolution.state === 'ISSUED' ? { issuedCount: { increment: 1 } } : { failedCount: { increment: 1 } }),
      resolvedAt: lastUnknown ? now : null,
      expiresAt: nextExpiresAt,
      lastProgressAt: now,
      version: { increment: 1 },
    },
  });
  if (updatedBatch.count !== 1) return { outcome: 'version-mismatch', audit, before };

  const updatedItem = await tx.credentialBatchItem.updateMany({
    where: {
      batchId: input.batchId,
      tenantId: input.tenantId,
      index: input.index,
      state: CredentialBatchItemState.OUTCOME_UNKNOWN,
    },
    data: {
      state: input.resolution.state === 'ISSUED' ? CredentialBatchItemState.ISSUED : CredentialBatchItemState.FAILED,
      credentialId: issuedCredentialId,
      warning: Prisma.DbNull,
      errorClass: input.resolution.state === 'FAILED' ? OPERATOR_CONFIRMED_FAILURE_CODE : null,
      errorMessage: input.resolution.state === 'FAILED' ? input.resolution.evidence.trim() : null,
      resolutionReason: input.reason.trim(),
      resolvedAt: now,
      attemptToken: null,
      updatedAt: now,
    },
  });
  if (updatedItem.count !== 1)
    throw new Error('Credential batch resolution changed the item without its batch counters');

  const afterBatch: CredentialBatchResolutionBatch = {
    ...batch,
    state: nextState,
    unknownCount: batch.unknownCount - 1,
    issuedCount: input.resolution.state === 'ISSUED' ? batch.issuedCount + 1 : batch.issuedCount,
    failedCount: input.resolution.state === 'FAILED' ? batch.failedCount + 1 : batch.failedCount,
    version: batch.version + 1,
    resolvedAt: lastUnknown ? now : null,
    expiresAt: nextExpiresAt,
  };
  const afterItem: CredentialBatchResolutionItem = {
    ...item,
    state: input.resolution.state === 'ISSUED' ? CredentialBatchItemState.ISSUED : CredentialBatchItemState.FAILED,
    credentialId: issuedCredentialId,
    errorClass: input.resolution.state === 'FAILED' ? OPERATOR_CONFIRMED_FAILURE_CODE : null,
    errorMessage: input.resolution.state === 'FAILED' ? input.resolution.evidence.trim() : null,
    updatedAt: now,
  };
  return {
    outcome: 'applied',
    audit,
    before,
    after: resolutionSnapshot(afterBatch, afterItem),
  };
}

const EXPIRY_SWEEP_LIMIT = 100;

/** Deletes retained item data and atomically changes each due batch into a tombstone. */
export async function expireDueCredentialBatches(now: Date = new Date(Date.now())): Promise<number> {
  let totalExpired = 0;
  for (;;) {
    const expiredInPass = await prisma.$transaction(
      async (tx) => {
        const dueBatches = await tx.credentialBatch.findMany({
          where: {
            expiresAt: { lte: now },
            state: CredentialBatchState.COMPLETED,
          },
          orderBy: { expiresAt: 'asc' },
          take: EXPIRY_SWEEP_LIMIT,
          select: { id: true },
        });
        let expired = 0;
        for (const batch of dueBatches) {
          const updated = await tx.credentialBatch.updateMany({
            where: {
              id: batch.id,
              expiresAt: { lte: now },
              state: CredentialBatchState.COMPLETED,
            },
            data: { state: CredentialBatchState.EXPIRED },
          });
          if (updated.count !== 1) continue;
          await tx.credentialBatchItem.deleteMany({ where: { batchId: batch.id } });
          expired += 1;
        }
        return { expired, selected: dueBatches.length };
      },
      // Match the 15 s transaction budget and 5 s pool wait used by larger writes in
      // src/lib/prisma/repositories/external-credential.repository.ts.
      { maxWait: 5_000, timeout: 15_000 },
    );
    totalExpired += expiredInPass.expired;
    if (expiredInPass.selected < EXPIRY_SWEEP_LIMIT) return totalExpired;
  }
}

async function itemNotApplied(
  tx: Prisma.TransactionClient,
  input: { batchId: string; tenantId: string; index: number },
): Promise<Extract<BatchMutationOutcome, { outcome: 'missing' | 'superseded' }>> {
  const item = await tx.credentialBatchItem.findFirst({
    where: { batchId: input.batchId, tenantId: input.tenantId, index: input.index },
    select: { state: true },
  });
  return item === null ? { outcome: 'missing' } : { outcome: 'superseded' };
}

function jsonValue(
  value: PrismaTypes.JsonValue | null | undefined,
): PrismaTypes.InputJsonValue | PrismaTypes.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** Marks a processing item issued and moves its stored counters atomically. */
export async function markItemIssued(
  tx: PrismaTypes.TransactionClient,
  input: {
    batchId: string;
    tenantId: string;
    index: number;
    token: string;
    credentialId: string;
    warning?: PrismaTypes.JsonValue | null;
  },
): Promise<BatchMutationOutcome> {
  await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  const now = new Date(Date.now());
  const item = await tx.credentialBatchItem.updateMany({
    where: {
      batchId: input.batchId,
      tenantId: input.tenantId,
      index: input.index,
      state: CredentialBatchItemState.PROCESSING,
      attemptToken: input.token,
    },
    data: {
      state: CredentialBatchItemState.ISSUED,
      credentialId: input.credentialId,
      warning: jsonValue(input.warning),
      errorClass: null,
      errorMessage: null,
      updatedAt: now,
    },
  });
  if (item.count !== 1) return itemNotApplied(tx, input);
  const batch = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      state: { in: [CredentialBatchState.QUEUED, CredentialBatchState.RUNNING] },
      attemptToken: input.token,
      processingCount: { gt: 0 },
    },
    data: {
      processingCount: { decrement: 1 },
      issuedCount: { increment: 1 },
      version: { increment: 1 },
      lastProgressAt: now,
    },
  });
  if (batch.count !== 1) throw new Error('Credential batch item was updated without its batch counters');
  return { outcome: 'applied' };
}

/** Marks a processing item failed and moves its stored counters atomically. */
export async function markItemFailed(
  tx: PrismaTypes.TransactionClient,
  input: {
    batchId: string;
    tenantId: string;
    index: number;
    token: string;
    errorClass: string;
    errorMessage: string;
  },
): Promise<BatchMutationOutcome> {
  await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  const now = new Date(Date.now());
  const item = await tx.credentialBatchItem.updateMany({
    where: {
      batchId: input.batchId,
      tenantId: input.tenantId,
      index: input.index,
      state: CredentialBatchItemState.PROCESSING,
      attemptToken: input.token,
    },
    data: {
      state: CredentialBatchItemState.FAILED,
      warning: Prisma.DbNull,
      errorClass: input.errorClass,
      errorMessage: input.errorMessage,
      updatedAt: now,
    },
  });
  if (item.count !== 1) return itemNotApplied(tx, input);
  const batch = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      state: { in: [CredentialBatchState.QUEUED, CredentialBatchState.RUNNING] },
      attemptToken: input.token,
      processingCount: { gt: 0 },
    },
    data: {
      processingCount: { decrement: 1 },
      failedCount: { increment: 1 },
      version: { increment: 1 },
      lastProgressAt: now,
    },
  });
  if (batch.count !== 1) throw new Error('Credential batch item was updated without its batch counters');
  return { outcome: 'applied' };
}

/** Finishes a pre-dispatch fault as failed, cancelled or queued for retry (#1080). */
export async function markItemQueued(
  tx: PrismaTypes.TransactionClient,
  input: { batchId: string; tenantId: string; index: number; token: string; errorMessage: string },
): Promise<BatchMutationOutcome> {
  const currentBatch = await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  if (currentBatch === null) return { outcome: 'missing' };
  if (currentBatch.attemptToken !== input.token) return { outcome: 'superseded' };
  const now = new Date(Date.now());
  const current = await tx.credentialBatchItem.findFirst({
    where: {
      batchId: input.batchId,
      tenantId: input.tenantId,
      index: input.index,
      state: CredentialBatchItemState.PROCESSING,
      attemptToken: input.token,
    },
    select: { attemptCount: true },
  });
  if (current === null) return itemNotApplied(tx, input);
  const attemptCount = current.attemptCount + 1;
  const exhausted = attemptCount >= credentialBatchItemAttemptLimit();
  const cancelled = !exhausted && currentBatch.cancelRequestedAt !== null;
  const item = await tx.credentialBatchItem.updateMany({
    where: {
      batchId: input.batchId,
      tenantId: input.tenantId,
      index: input.index,
      state: CredentialBatchItemState.PROCESSING,
      attemptToken: input.token,
      attemptCount: current.attemptCount,
    },
    data: {
      state: exhausted
        ? CredentialBatchItemState.FAILED
        : cancelled
          ? CredentialBatchItemState.CANCELLED
          : CredentialBatchItemState.QUEUED,
      attemptToken: null,
      warning: Prisma.DbNull,
      errorClass: exhausted ? 'ITEM_ATTEMPTS_EXHAUSTED' : null,
      errorMessage: exhausted ? input.errorMessage : null,
      attemptCount,
      nextAttemptAt:
        exhausted || cancelled
          ? null
          : new Date(now.getTime() + credentialBatchItemBackoffSeconds(attemptCount) * 1_000),
      updatedAt: now,
    },
  });
  if (item.count !== 1) return itemNotApplied(tx, input);
  const batch = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      state: { in: [CredentialBatchState.QUEUED, CredentialBatchState.RUNNING] },
      attemptToken: input.token,
      processingCount: { gt: 0 },
    },
    data: {
      processingCount: { decrement: 1 },
      ...(exhausted
        ? { failedCount: { increment: 1 } }
        : cancelled
          ? { cancelledCount: { increment: 1 } }
          : { queuedCount: { increment: 1 } }),
      version: { increment: 1 },
      lastProgressAt: now,
    },
  });
  if (batch.count !== 1) throw new Error('Credential batch item transition was applied without its batch counters');
  return exhausted ? { outcome: 'attempts-exhausted' } : { outcome: 'applied' };
}

/** Records a credential id learned after ownership was lost, without fencing on the old token. */
export async function recordKnownCredentialId(
  tx: PrismaTypes.TransactionClient,
  input: { batchId: string; tenantId: string; index: number; credentialId: string },
): Promise<{ applied: boolean }> {
  await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  const now = new Date(Date.now());
  const updated = await tx.credentialBatchItem.updateMany({
    where: {
      batchId: input.batchId,
      tenantId: input.tenantId,
      index: input.index,
      state: CredentialBatchItemState.OUTCOME_UNKNOWN,
      credentialId: null,
    },
    data: { credentialId: input.credentialId, updatedAt: now },
  });
  if (updated.count === 1) {
    await tx.credentialBatch.updateMany({
      where: { id: input.batchId, tenantId: input.tenantId },
      data: { version: { increment: 1 }, lastProgressAt: now },
    });
  }
  return { applied: updated.count === 1 };
}

/** Marks a processing item outcome unknown after an interrupted external effect. */
export async function markItemOutcomeUnknown(
  tx: PrismaTypes.TransactionClient,
  input: {
    batchId: string;
    tenantId: string;
    index: number;
    token: string;
    errorClass: string;
    errorMessage: string;
    credentialId?: string;
  },
): Promise<BatchMutationOutcome> {
  await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  const now = new Date(Date.now());
  const item = await tx.credentialBatchItem.updateMany({
    where: {
      batchId: input.batchId,
      tenantId: input.tenantId,
      index: input.index,
      state: CredentialBatchItemState.PROCESSING,
      attemptToken: input.token,
    },
    data: {
      state: CredentialBatchItemState.OUTCOME_UNKNOWN,
      warning: Prisma.DbNull,
      errorClass: input.errorClass,
      errorMessage: input.errorMessage,
      ...(input.credentialId === undefined ? {} : { credentialId: input.credentialId }),
      updatedAt: now,
    },
  });
  if (item.count !== 1) return itemNotApplied(tx, input);
  const batch = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      state: { in: [CredentialBatchState.QUEUED, CredentialBatchState.RUNNING] },
      attemptToken: input.token,
      processingCount: { gt: 0 },
    },
    data: {
      processingCount: { decrement: 1 },
      unknownCount: { increment: 1 },
      version: { increment: 1 },
      lastProgressAt: now,
    },
  });
  if (batch.count !== 1) throw new Error('Credential batch item was updated without its batch counters');
  return { outcome: 'applied' };
}

/** Claims the next queued item for this attempt and moves it into PROCESSING. */
export async function claimNextBatchItem(
  tx: PrismaTypes.TransactionClient,
  input: { batchId: string; tenantId: string; token: string },
): Promise<
  | { outcome: 'claimed'; item: { index: number; request: string } }
  | { outcome: 'empty'; nextAttemptAt?: Date }
  | { outcome: 'cancelled' }
  | { outcome: 'missing' | 'superseded' }
> {
  const current = await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  if (current === null) return { outcome: 'missing' };
  if (current.cancelRequestedAt !== null) return { outcome: 'cancelled' };
  if (current.state !== CredentialBatchState.RUNNING || current.attemptToken !== input.token) {
    return { outcome: 'superseded' };
  }
  for (;;) {
    const now = new Date(Date.now());
    const item = await tx.credentialBatchItem.findFirst({
      where: {
        batchId: input.batchId,
        tenantId: input.tenantId,
        state: CredentialBatchItemState.QUEUED,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: [{ attemptCount: 'asc' }, { index: 'asc' }],
      select: { index: true, request: true },
    });
    if (item === null) {
      const deferred = await tx.credentialBatchItem.findFirst({
        where: {
          batchId: input.batchId,
          tenantId: input.tenantId,
          state: CredentialBatchItemState.QUEUED,
          nextAttemptAt: { gt: now },
        },
        orderBy: { nextAttemptAt: 'asc' },
        select: { nextAttemptAt: true },
      });
      return deferred?.nextAttemptAt === null || deferred === null
        ? { outcome: 'empty' }
        : { outcome: 'empty', nextAttemptAt: deferred.nextAttemptAt };
    }
    const updated = await tx.credentialBatchItem.updateMany({
      where: {
        batchId: input.batchId,
        tenantId: input.tenantId,
        index: item.index,
        state: CredentialBatchItemState.QUEUED,
      },
      data: { state: CredentialBatchItemState.PROCESSING, attemptToken: input.token, nextAttemptAt: null },
    });
    if (updated.count !== 1) continue;
    const batch = await tx.credentialBatch.updateMany({
      where: {
        id: input.batchId,
        tenantId: input.tenantId,
        state: CredentialBatchState.RUNNING,
        attemptToken: input.token,
        queuedCount: { gt: 0 },
      },
      data: {
        queuedCount: { decrement: 1 },
        processingCount: { increment: 1 },
        version: { increment: 1 },
        lastProgressAt: new Date(Date.now()),
      },
    });
    if (batch.count !== 1) throw new Error('Credential batch item was claimed without its batch counters');
    return { outcome: 'claimed', item };
  }
}

/** Settles a batch once its stored counters show that no work remains. */
export async function settleBatchIfFinished(
  tx: Prisma.TransactionClient,
  input: { batchId: string; tenantId: string; token: string },
): Promise<BatchSettlementOutcome> {
  const batch = await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  if (batch === null) return { outcome: 'missing' };
  return settleLockedBatch(tx, batch, input.token);
}

function settledBatchState(unknownCount: number, cancelledCount: number): CredentialBatchState {
  if (unknownCount > 0) return CredentialBatchState.NEEDS_ATTENTION;
  return cancelledCount > 0 ? CredentialBatchState.CANCELLED : CredentialBatchState.COMPLETED;
}

async function settleLockedBatch(
  tx: PrismaTypes.TransactionClient,
  batch: NonNullable<Awaited<ReturnType<typeof lockCredentialBatchForUpdate>>>,
  token: string | null,
): Promise<BatchSettlementOutcome> {
  if (batch.state !== CredentialBatchState.QUEUED && batch.state !== CredentialBatchState.RUNNING) {
    return { outcome: 'already-settled' };
  }
  if (batch.queuedCount !== 0 || batch.processingCount !== 0) return { outcome: 'not-ready' };
  if (batch.issuedCount + batch.failedCount + batch.unknownCount + batch.cancelledCount !== batch.itemCount) {
    return { outcome: 'not-ready' };
  }
  const settledAt = new Date(Date.now());
  const state = settledBatchState(batch.unknownCount, batch.cancelledCount);
  const expiresAt =
    state !== CredentialBatchState.NEEDS_ATTENTION
      ? new Date(settledAt.getTime() + readBatchRetentionDays() * 24 * 60 * 60 * 1_000)
      : null;
  const updated = await tx.credentialBatch.updateMany({
    where: {
      id: batch.id,
      tenantId: batch.tenantId,
      state: { in: [CredentialBatchState.QUEUED, CredentialBatchState.RUNNING] },
      attemptToken: token,
      version: batch.version,
      queuedCount: 0,
      processingCount: 0,
    },
    data: {
      state,
      settledAt,
      expiresAt,
      attemptToken: null,
      attemptStartedAt: null,
      lastProgressAt: settledAt,
      version: { increment: 1 },
    },
  });
  return updated.count === 1 ? { outcome: 'applied', state } : { outcome: 'superseded' };
}

/** Claims one worker attempt using the expected batch version as a fence. */
export async function claimBatchAttempt(
  tx: PrismaTypes.TransactionClient,
  input: {
    batchId: string;
    tenantId: string;
    token: string;
    expectedVersion: number;
    staleBefore?: Date;
  },
): Promise<{ applied: boolean }> {
  const now = new Date(Date.now());
  const current = await lockCredentialBatchForUpdate(tx, input.batchId, input.tenantId);
  if (
    current === null ||
    current.version !== input.expectedVersion ||
    (current.state !== CredentialBatchState.QUEUED && current.state !== CredentialBatchState.RUNNING)
  ) {
    return { applied: false };
  }
  const takingOver =
    current.attemptToken !== null &&
    current.attemptToken !== input.token &&
    input.staleBefore !== undefined &&
    current.lastProgressAt <= input.staleBefore;
  if (current.attemptToken !== null && !takingOver) {
    return { applied: false };
  }
  let unknownCount = 0;
  if (takingOver) {
    unknownCount = await markInterruptedItems(tx, {
      where: {
        batchId: input.batchId,
        tenantId: input.tenantId,
        state: CredentialBatchItemState.PROCESSING,
        attemptToken: current.attemptToken,
      },
      batchCorrelationId: current.correlationId,
      now,
    });
  } else if (current.attemptToken === null) {
    unknownCount = await markInterruptedItems(tx, {
      where: {
        batchId: input.batchId,
        tenantId: input.tenantId,
        state: CredentialBatchItemState.PROCESSING,
        OR: [{ attemptToken: { not: input.token } }, { attemptToken: null }],
      },
      batchCorrelationId: current.correlationId,
      now,
    });
  }
  const updated = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      version: input.expectedVersion,
      ...(current.attemptToken === null
        ? { attemptToken: null }
        : { attemptToken: current.attemptToken, lastProgressAt: { lte: input.staleBefore } }),
      state: { in: [CredentialBatchState.QUEUED, CredentialBatchState.RUNNING] },
    },
    data: {
      state: CredentialBatchState.RUNNING,
      attemptToken: input.token,
      attemptStartedAt: now,
      lastProgressAt: now,
      ...(unknownCount > 0
        ? {
            processingCount: { decrement: unknownCount },
            unknownCount: { increment: unknownCount },
          }
        : {}),
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1 && unknownCount > 0) throw new CredentialBatchAttemptFenceLostError();
  return { applied: updated.count === 1 };
}

async function markInterruptedItems(
  tx: PrismaTypes.TransactionClient,
  input: {
    where: PrismaTypes.CredentialBatchItemWhereInput;
    batchCorrelationId: string;
    now: Date;
  },
): Promise<number> {
  const items = await tx.credentialBatchItem.findMany({ where: input.where, select: { index: true } });
  let count = 0;
  for (const item of items) {
    const derivedItemCorrelationId = credentialBatchItemCorrelationId(input.batchCorrelationId, item.index);
    const errorMessage = isValidCorrelationId(derivedItemCorrelationId)
      ? interruptedBatchItemMessage({ itemCorrelationId: derivedItemCorrelationId })
      : interruptedBatchItemMessage({ batchCorrelationId: input.batchCorrelationId, index: item.index });
    const updated = await tx.credentialBatchItem.updateMany({
      where: { ...input.where, index: item.index },
      data: {
        state: CredentialBatchItemState.OUTCOME_UNKNOWN,
        errorClass: 'OUTCOME_UNKNOWN',
        errorMessage,
        warning: Prisma.DbNull,
        updatedAt: input.now,
      },
    });
    count += updated.count;
  }
  return count;
}

/** Claims a stalled batch for reconciliation, then leaves the fresh job free to claim it. */
export async function claimBatchAttemptAndRelease(
  tx: PrismaTypes.TransactionClient,
  input: {
    batchId: string;
    tenantId: string;
    token: string;
    expectedVersion: number;
    staleBefore?: Date;
  },
): Promise<{ applied: boolean }> {
  const claimed = await claimBatchAttempt(tx, input);
  if (!claimed.applied) return claimed;
  const released = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      state: CredentialBatchState.RUNNING,
      attemptToken: input.token,
    },
    data: { attemptToken: null, attemptStartedAt: null, version: { increment: 1 } },
  });
  if (released.count !== 1) throw new CredentialBatchAttemptFenceLostError();
  return { applied: true };
}

/** Checkpoints a normal continuation and atomically places its next job. */
export async function checkpointBatchContinuation(
  tx: PrismaTypes.TransactionClient,
  input: {
    batchId: string;
    tenantId: string;
    token: string;
    correlationId: string;
    queue: JobQueue;
    startAfter?: Date;
  },
): Promise<{ applied: boolean }> {
  const now = new Date(Date.now());
  const updated = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      state: CredentialBatchState.RUNNING,
      attemptToken: input.token,
    },
    data: {
      attemptToken: null,
      attemptStartedAt: null,
      lastProgressAt: now,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) return { applied: false };
  const enqueueOptions = getCredentialBatchIssueEnqueueOptions();
  await input.queue.enqueueWithin(
    prismaSqlExecutor(tx),
    CREDENTIAL_BATCH_ISSUE_JOB,
    { batchId: input.batchId, tenantId: input.tenantId, correlationId: input.correlationId },
    input.startAfter === undefined ? enqueueOptions : { ...enqueueOptions, startAfter: input.startAfter },
  );
  return { applied: true };
}

export type StalledCredentialBatch = Prisma.CredentialBatchGetPayload<{
  select: {
    id: true;
    tenantId: true;
    correlationId: true;
    state: true;
    version: true;
    attemptToken: true;
    lastProgressAt: true;
  };
}>;

/** Signals that an attempt lost its batch fence after changing item rows. */
export class CredentialBatchAttemptFenceLostError extends Error {
  constructor() {
    super('Credential batch attempt lost its ownership fence while claiming');
    this.name = 'CredentialBatchAttemptFenceLostError';
  }
}

/** Finds unfinished batches whose progress fence is older than the reconciliation threshold. */
export async function findStalledCredentialBatches(staleBefore: Date, take = 100): Promise<StalledCredentialBatch[]> {
  return prisma.credentialBatch.findMany({
    where: {
      state: { in: [CredentialBatchState.QUEUED, CredentialBatchState.RUNNING] },
      lastProgressAt: { lte: staleBefore },
    },
    orderBy: { lastProgressAt: 'asc' },
    take,
    select: {
      id: true,
      tenantId: true,
      correlationId: true,
      state: true,
      version: true,
      attemptToken: true,
      lastProgressAt: true,
    },
  });
}

/** Releases a still-owned attempt so reconciliation or retry can claim it. */
export async function releaseBatchAttempt(
  tx: PrismaTypes.TransactionClient,
  input: { batchId: string; tenantId: string; token: string },
): Promise<{ applied: boolean }> {
  const now = new Date(Date.now());
  const updated = await tx.credentialBatch.updateMany({
    where: {
      id: input.batchId,
      tenantId: input.tenantId,
      state: CredentialBatchState.RUNNING,
      attemptToken: input.token,
    },
    data: { attemptToken: null, attemptStartedAt: null, lastProgressAt: now, version: { increment: 1 } },
  });
  return { applied: updated.count === 1 };
}
