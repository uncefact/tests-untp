import { EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import { IdempotencyOperation } from '../generated';
import { prisma } from '../prisma';
import { isUniqueConstraintViolation } from '@/lib/prisma/db-errors';
import { readStaleClaimMs } from '@/lib/config/idempotency-claim.config';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'idempotency-key.repository' });

/**
 * Thrown when a claim can no longer be associated with what it produced,
 * because another request reclaimed the key first. The work that produced it
 * is rolled back with the transaction that raises this, so the reclaiming
 * request stays the only one whose result is recorded (#954, ADR-051).
 */
export class IdempotencyClaimLostError extends Error {
  constructor() {
    super('The Idempotency-Key claim was reclaimed before the result could be associated');
    this.name = 'IdempotencyClaimLostError';
  }
}

/**
 * How long a claim may sit unfinished before another request may take its key.
 *
 * A claim this old that never recorded a result is deleted, and the
 * request that finds it proceeds as a first claim. One that did record a
 * result is replayed instead, because that result exists and must not be
 * produced again. Read per call rather than at module load so an operator's
 * IDEMPOTENCY_STALE_CLAIM_MINUTES applies without a rebuild, and so a test
 * can vary it (#954, ADR-051).
 */
function staleClaimMs(): number {
  return readStaleClaimMs();
}

export type ClaimIdempotencyKeyInput = {
  tenantId: string;
  operation: IdempotencyOperation;
  key: string;
  bodyDigest: string;
};

export type IdempotencyReplay = {
  outcome: 'replay';
  credentialId: string;
  responseBody: unknown;
  /**
   * Set when a stored response body existed but could not be read, for
   * example after DATA_ENCRYPTION_KEY was rotated. The credential id is
   * still authoritative; only the recorded body is lost, and the route
   * tells the caller so instead of replaying silently without it.
   */
  responseBodyUnreadable?: true;
};

export type ClaimIdempotencyKeyResult =
  | { outcome: 'claimed'; claimId: string }
  | { outcome: 'in-flight' }
  | { outcome: 'mismatch' }
  | IdempotencyReplay;

export type FindIdempotencyKeyResult =
  | { outcome: 'absent' }
  | { outcome: 'in-flight' }
  | { outcome: 'mismatch' }
  | IdempotencyReplay;

export type CompleteIdempotencyKeyInput = {
  claimId: string;
  credentialId: string;
  responseBody: unknown;
};

export type ReleaseIdempotencyKeyInput = {
  claimId: string;
};

export type IdempotencyMutationResult = { applied: boolean };

type StoredClaim = {
  id: string;
  tenantId: string;
  operation: IdempotencyOperation;
  bodyDigest: string;
  credentialId: string | null;
  resultRecordedAt: Date | null;
  responseBody: string | null;
  createdAt: Date;
  finalisedAt: Date | null;
};

type InterpretedClaim =
  | { outcome: 'mismatch' }
  | { outcome: 'in-flight' }
  | { outcome: 'stale-empty' }
  | IdempotencyReplay;

/**
 * Looks up a per-tenant idempotency key without claiming it (#954, ADR-051).
 *
 * Used before request validation so an exact retry can replay (or a mismatch
 * or in-flight request can be rejected) even if a dependency has since
 * become unavailable. A stale row with no result is `absent` so the caller
 * can validate and then claim, which reclaims it.
 */
export async function findIdempotencyKey(input: ClaimIdempotencyKeyInput): Promise<FindIdempotencyKeyResult> {
  const existing = await findClaim(input.tenantId, input.operation, input.key);
  if (!existing) {
    return { outcome: 'absent' };
  }
  const interpreted = await interpretRow(existing, input.bodyDigest);
  if (interpreted.outcome === 'stale-empty') {
    return { outcome: 'absent' };
  }
  return interpreted;
}

/**
 * Claims a per-tenant idempotency key, or classifies an existing row for
 * the same tenant, operation and key (#954, ADR-051).
 *
 * Inserts a new row. A unique collision on `(tenantId, operation, key)` is
 * classified from the stored row: a different body digest is `mismatch`; a
 * live unfinalised row is `in-flight`; a finalised row, or a stale row that
 * already recorded a result, is `replay`; a stale row with no result is
 * deleted and the claim retried.
 */
export async function claimIdempotencyKey(input: ClaimIdempotencyKeyInput): Promise<ClaimIdempotencyKeyResult> {
  try {
    const claimId = await insertClaim(input);
    return { outcome: 'claimed', claimId };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
  }
  return resolveExistingClaim(input);
}

/**
 * Compare-and-set of the final response on this claim (#954, ADR-051). Writes
 * `responseBody` and `finalisedAt` only while this claim still owns
 * `credentialId` and `finalisedAt` is null, so a stale replayer and the
 * original cannot overwrite each other. A lost race is `applied: false`;
 * the caller re-reads the winner's finalised body.
 */
export async function completeIdempotencyKey(input: CompleteIdempotencyKeyInput): Promise<IdempotencyMutationResult> {
  const updated = await prisma.idempotencyKey.updateMany({
    where: { id: input.claimId, credentialId: input.credentialId, finalisedAt: null },
    data: {
      responseBody: protectResponseBody(input.responseBody),
      finalisedAt: new Date(Date.now()),
    },
  });
  return { applied: updated.count > 0 };
}

/**
 * Drops a claimed key so a failed operation can be retried. Addresses the
 * row by `claimId` and only while `credentialId` is still null, so a
 * reclaimed original cannot delete a later owner's row (#954). A
 * non-matching row is a no-op (`applied: false`).
 */
export async function releaseIdempotencyKey(input: ReleaseIdempotencyKeyInput): Promise<IdempotencyMutationResult> {
  const deleted = await prisma.idempotencyKey.deleteMany({
    where: { id: input.claimId, credentialId: null },
  });
  return { applied: deleted.count > 0 };
}

async function insertClaim(input: ClaimIdempotencyKeyInput): Promise<string> {
  const row = await prisma.idempotencyKey.create({
    data: {
      tenantId: input.tenantId,
      operation: input.operation,
      key: input.key,
      bodyDigest: input.bodyDigest,
    },
  });
  return row.id;
}

async function resolveExistingClaim(input: ClaimIdempotencyKeyInput): Promise<ClaimIdempotencyKeyResult> {
  const existing = await findClaim(input.tenantId, input.operation, input.key);
  if (!existing) {
    return reclaimAfterInsertRace(input);
  }
  const interpreted = await interpretRow(existing, input.bodyDigest);
  if (interpreted.outcome === 'stale-empty') {
    await deleteStaleClaim(input);
    return reclaimAfterInsertRace(input);
  }
  return interpreted;
}

/**
 * Retries {@link insertClaim} after a caller has established there is no
 * live row to collide with (the key was missing, or its stale row was just
 * deleted). A unique collision here means another request claimed the key
 * in between; the winning row is looked up and classified.
 */
async function reclaimAfterInsertRace(input: ClaimIdempotencyKeyInput): Promise<ClaimIdempotencyKeyResult> {
  try {
    const claimId = await insertClaim(input);
    return { outcome: 'claimed', claimId };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
  }
  const raced = await findClaim(input.tenantId, input.operation, input.key);
  if (!raced) {
    return { outcome: 'in-flight' };
  }
  const interpreted = await interpretRow(raced, input.bodyDigest);
  if (interpreted.outcome === 'stale-empty') {
    return { outcome: 'in-flight' };
  }
  return interpreted;
}

async function deleteStaleClaim(input: ClaimIdempotencyKeyInput): Promise<void> {
  await prisma.idempotencyKey.deleteMany({
    where: {
      tenantId: input.tenantId,
      operation: input.operation,
      key: input.key,
      credentialId: null,
      createdAt: { lte: staleCutoff() },
    },
  });
}

/**
 * Classifies a stored row against the requested body digest. A row with a
 * credential and no `finalisedAt` is in-flight while `resultRecordedAt`
 * is fresh, and a replay of the recorded result once that clock is
 * stale (the original never delivered its response, so the result
 * must not be produced again). An empty claim ages from `createdAt`.
 */
async function interpretRow(row: StoredClaim, bodyDigest: string): Promise<InterpretedClaim> {
  if (row.bodyDigest !== bodyDigest) {
    return { outcome: 'mismatch' };
  }
  if (row.credentialId) {
    if (row.finalisedAt == null && !isStaleRecordedClaim(row.resultRecordedAt)) {
      return { outcome: 'in-flight' };
    }
    const revealed = revealResponseBody(row);
    if (row.finalisedAt == null) {
      // An unreadable body finalises as no body: future replays could not
      // read it either, so the stored state now says what every caller
      // will actually receive.
      const { applied } = await completeIdempotencyKey({
        claimId: row.id,
        credentialId: row.credentialId,
        responseBody: revealed.value,
      });
      if (!applied) {
        return readWinnerReplay(row.id, row.credentialId, revealed);
      }
    }
    return {
      outcome: 'replay',
      credentialId: row.credentialId,
      responseBody: revealed.value,
      ...(revealed.unreadable ? { responseBodyUnreadable: true as const } : {}),
    };
  }
  if (isStaleInFlight(row.createdAt)) {
    return { outcome: 'stale-empty' };
  }
  return { outcome: 'in-flight' };
}

async function readWinnerReplay(
  claimId: string,
  fallbackCredentialId: string,
  fallbackResponseBody: RevealedResponseBody,
): Promise<IdempotencyReplay> {
  const current = await prisma.idempotencyKey.findUnique({
    where: { id: claimId },
  });
  if (!current?.credentialId) {
    return {
      outcome: 'replay',
      credentialId: fallbackCredentialId,
      responseBody: fallbackResponseBody.value,
      ...(fallbackResponseBody.unreadable ? { responseBodyUnreadable: true as const } : {}),
    };
  }
  const revealed = revealResponseBody(current);
  return {
    outcome: 'replay',
    credentialId: current.credentialId,
    responseBody: revealed.value,
    ...(revealed.unreadable ? { responseBodyUnreadable: true as const } : {}),
  };
}

async function findClaim(tenantId: string, operation: IdempotencyOperation, key: string) {
  return prisma.idempotencyKey.findUnique({
    where: { tenantId_operation_key: { tenantId, operation, key } },
  });
}

function isStaleInFlight(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() >= staleClaimMs();
}

function isStaleRecordedClaim(resultRecordedAt: Date | null): boolean {
  if (resultRecordedAt == null) {
    return false;
  }
  return isStaleInFlight(resultRecordedAt);
}

function staleCutoff(): Date {
  return new Date(Date.now() - staleClaimMs());
}

/**
 * SQL NULL for an absent body, never an envelope of JSON `null`. Callers still
 * pass and receive a plain value; only this repository writes the envelope.
 */
function protectResponseBody(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(getEncryptionService().encrypt(JSON.stringify(value), EncryptionAlgorithm.AES_256_GCM));
}

type RevealedResponseBody = { value: unknown; unreadable?: true };

/**
 * Recovers the stored response body. A body that cannot be read (for
 * example after DATA_ENCRYPTION_KEY was rotated) yields `unreadable` so a
 * retry still returns the credential id rather than becoming a 500, and
 * the route can tell the caller the recorded body was lost. The log line
 * names the stage that failed so an operator can tell one corrupted row
 * from a key rotation that broke every row (#954, ADR-051).
 */
function revealResponseBody(
  row: Pick<StoredClaim, 'id' | 'tenantId' | 'operation' | 'responseBody'>,
): RevealedResponseBody {
  if (row.responseBody === null) {
    return { value: null };
  }
  let stage = 'parse-envelope';
  try {
    const envelope = JSON.parse(row.responseBody);
    stage = 'decrypt';
    const plaintext = getEncryptionService().decrypt(envelope);
    stage = 'parse-plaintext';
    return { value: JSON.parse(plaintext) };
  } catch (error) {
    logger.error(
      { err: error, stage, claimId: row.id, tenantId: row.tenantId, operation: row.operation },
      'Failed to read stored idempotency response body',
    );
    return { value: null, unreadable: true };
  }
}
