import type { CanonicalCredentialStatusEntry } from '@uncefact/untp-ri-services';
import { CredentialStatusProvenance, Prisma, type CredentialStatusEntry } from '../generated';
import { isUniqueConstraintViolation } from '@/lib/prisma/db-errors';
import { SYSTEM_TENANT_ID } from '../constants';
import { lockLibraryRecordForUpdate } from './library-record.repository';
import { lockServiceInstanceForUpdate } from './service-instance-lock.repository';

export type CreateCredentialStatusEntryInput = {
  canonical: CanonicalCredentialStatusEntry;
  wire: Record<string, unknown>;
  statusListVcIssuer: string;
  provenance: CredentialStatusProvenance;
};

export type CreateCredentialStatusEntriesInput = {
  credentialId: string;
  tenantId: string;
  entries: readonly CreateCredentialStatusEntryInput[];
};

export type CreateCredentialStatusEntriesOutcome =
  | { outcome: 'created'; count: number }
  | { outcome: 'duplicate_purpose'; purpose: string };

export type ReserveStatusChangeInput = {
  entryId: string;
  credentialId: string;
  tenantId: string;
  expectedVersion: number;
  value: boolean;
  budgetMs: number;
  instanceId: string;
  configDigest: string;
  token: string;
};

export type ReserveStatusChangeOutcome =
  | { outcome: 'reserved'; pendingSince: Date; pendingDeadline: Date }
  | 'version_conflict'
  | 'pending_exists'
  | 'pending_expired'
  | 'instance_missing'
  | 'missing';

export type FinaliseStatusChangeInput = {
  entryId: string;
  credentialId: string;
  tenantId: string;
  token: string;
  expectedVersion: number;
  value: boolean;
  observedAt: Date;
  instanceId: string;
};

export type FinaliseStatusChangeOutcome =
  | 'finalised'
  | 'token_mismatch'
  | 'version_conflict'
  | 'instance_missing'
  | 'missing';

export type ClearPendingIntentOutcome =
  | 'cleared'
  | 'already_cleared'
  | 'token_mismatch'
  | 'instance_missing'
  | 'missing';

export type PersistObservationWithoutPendingInput = {
  entryId: string;
  credentialId: string;
  tenantId: string;
  expectedVersion: number;
  value: boolean;
  observedAt: Date;
  instanceId: string;
};

export type PersistObservationWithoutPendingOutcome =
  | 'persisted'
  | 'version_conflict'
  | 'pending_exists'
  | 'instance_missing'
  | 'missing';

/** Locks the attributed tenant or system instance without falling back to a primary. */
export async function lockStatusServiceInstance(
  tx: Prisma.TransactionClient,
  instanceId: string,
  credentialTenantId: string,
): Promise<boolean> {
  const instance = await tx.serviceInstance.findFirst({
    where: {
      id: instanceId,
      OR: [{ tenantId: credentialTenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    select: { tenantId: true },
  });
  if (instance === null) return false;
  return lockServiceInstanceForUpdate(tx, instanceId, instance.tenantId);
}

/** Creates all status entries for one credential in one database statement. */
export async function createCredentialStatusEntries(
  tx: Prisma.TransactionClient,
  input: CreateCredentialStatusEntriesInput,
): Promise<CreateCredentialStatusEntriesOutcome> {
  const seenPurposes = new Set<string>();
  for (const candidate of input.entries) {
    if (seenPurposes.has(candidate.canonical.statusPurpose)) {
      return { outcome: 'duplicate_purpose', purpose: candidate.canonical.statusPurpose };
    }
    seenPurposes.add(candidate.canonical.statusPurpose);
  }

  if (input.entries.length === 0) return { outcome: 'created', count: 0 };

  const existing = await tx.credentialStatusEntry.findFirst({
    where: {
      credentialId: input.credentialId,
      tenantId: input.tenantId,
      statusPurpose: { in: [...seenPurposes] },
    },
    select: { statusPurpose: true },
    orderBy: { statusPurpose: 'asc' },
  });
  if (existing !== null) return { outcome: 'duplicate_purpose', purpose: existing.statusPurpose };

  const data = input.entries.map((candidate) => ({
    credentialId: input.credentialId,
    tenantId: input.tenantId,
    originalId: candidate.canonical.id ?? null,
    type: candidate.canonical.type,
    statusPurpose: candidate.canonical.statusPurpose,
    statusListCredential: candidate.canonical.statusListCredential,
    statusListIndex: candidate.canonical.statusListIndex,
    statusListVcIssuer: candidate.statusListVcIssuer,
    descriptor: plainJsonObject(candidate.wire),
    provenance: candidate.provenance,
  }));

  try {
    await tx.$executeRaw`SAVEPOINT credential_status_entries_create`;
    const result = await tx.credentialStatusEntry.createMany({ data });
    return { outcome: 'created', count: result.count };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT credential_status_entries_create`;
    const existingPurposes = await tx.credentialStatusEntry.findMany({
      where: {
        credentialId: input.credentialId,
        tenantId: input.tenantId,
        statusPurpose: { in: [...seenPurposes] },
      },
      select: { statusPurpose: true },
    });
    const existingPurposeSet = new Set(existingPurposes.map(({ statusPurpose }) => statusPurpose));
    const collidingPurpose = input.entries.find((candidate) =>
      existingPurposeSet.has(candidate.canonical.statusPurpose),
    )?.canonical.statusPurpose;
    if (collidingPurpose === undefined) {
      throw new Error('Invariant violation: unique status-entry collision has no existing purpose');
    }
    return { outcome: 'duplicate_purpose', purpose: collidingPurpose };
  }
}

/** Lists a credential's entries in stable purpose order, scoped to its tenant. */
export function listCredentialStatusEntries(
  tx: Prisma.TransactionClient,
  credentialId: string,
  tenantId: string,
): Promise<CredentialStatusEntry[]> {
  return tx.credentialStatusEntry.findMany({
    where: { credentialId, tenantId },
    orderBy: [{ statusPurpose: 'asc' }, { id: 'asc' }],
  });
}

/** Reads one status entry by credential, tenant and status purpose. */
export function getCredentialStatusEntry(
  tx: Prisma.TransactionClient,
  credentialId: string,
  tenantId: string,
  statusPurpose: string,
): Promise<CredentialStatusEntry | null> {
  return tx.credentialStatusEntry.findFirst({
    where: { credentialId, tenantId, statusPurpose },
  });
}

/** Classifies a failed reservation using PostgreSQL's transaction clock. */
async function classifyReservationFailure(
  tx: Prisma.TransactionClient,
  input: ReserveStatusChangeInput,
): Promise<Exclude<ReserveStatusChangeOutcome, { outcome: 'reserved' }>> {
  const rows = await tx.$queryRaw<
    Array<{ version: number; pendingToken: string | null; pendingDeadline: Date | null; expired: boolean }>
  >`
    SELECT "version", "pendingToken", "pendingDeadline",
           ("pendingDeadline" IS NOT NULL AND "pendingDeadline" < CURRENT_TIMESTAMP) AS "expired"
      FROM "CredentialStatusEntry"
     WHERE "id" = ${input.entryId}
       AND "credentialId" = ${input.credentialId}
       AND "tenantId" = ${input.tenantId}
  `;
  const current = rows[0];
  if (current === undefined) return 'missing';
  if (current.pendingToken !== null) {
    return current.expired ? 'pending_expired' : 'pending_exists';
  }
  return 'version_conflict';
}

/**
 * Reserves a status mutation with one conditional update. The affected-row
 * count is the write outcome; the read after zero rows only labels why no
 * reservation was made for the caller.
 */
export async function reserveStatusChange(
  tx: Prisma.TransactionClient,
  input: ReserveStatusChangeInput,
): Promise<ReserveStatusChangeOutcome> {
  const parentLocked = await lockLibraryRecordForUpdate(tx, input.credentialId, input.tenantId);
  if (!parentLocked) return classifyReservationFailure(tx, input);
  if (!(await lockStatusServiceInstance(tx, input.instanceId, input.tenantId))) {
    return 'instance_missing';
  }
  const result = await tx.$executeRaw`
    UPDATE "CredentialStatusEntry"
       SET "pendingValue" = ${input.value},
           "pendingSince" = CURRENT_TIMESTAMP,
           "pendingDeadline" = CURRENT_TIMESTAMP + (${input.budgetMs} * INTERVAL '1 millisecond'),
           "pendingToken" = ${input.token},
           "pendingInstanceId" = ${input.instanceId},
           "pendingConfigDigest" = ${input.configDigest},
           "acceptedReplacementDigest" = NULL,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = ${input.entryId}
       AND "credentialId" = ${input.credentialId}
       AND "tenantId" = ${input.tenantId}
       AND "version" = ${input.expectedVersion}
       AND "pendingToken" IS NULL
  `;
  if (result !== 1) return classifyReservationFailure(tx, input);

  const reserved = await tx.credentialStatusEntry.findFirst({
    where: { id: input.entryId, credentialId: input.credentialId, tenantId: input.tenantId },
    select: { pendingSince: true, pendingDeadline: true },
  });
  if (reserved?.pendingSince === null || reserved?.pendingDeadline === null || reserved === null) {
    throw new Error(`Invariant violation: reserved credential status entry "${input.entryId}" has no deadline`);
  }
  return { outcome: 'reserved', pendingSince: reserved.pendingSince, pendingDeadline: reserved.pendingDeadline };
}

/** Reads the current pending token without acquiring a row lock. */
export async function readPendingToken(
  tx: Prisma.TransactionClient,
  entryId: string,
  tenantId: string,
): Promise<string | null> {
  const row = await tx.credentialStatusEntry.findFirst({
    where: { id: entryId, tenantId },
    select: { pendingToken: true },
  });
  return row?.pendingToken ?? null;
}

/**
 * Touches the already-locked parent. A zero-row update means the lock and the
 * child write violated the repository invariant, so it must not be swallowed.
 */
async function touchCredentialRecord(
  tx: Prisma.TransactionClient,
  credentialId: string,
  tenantId: string,
): Promise<void> {
  const result = await tx.$executeRaw`
    UPDATE "LibraryRecord"
       SET "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = ${credentialId}
       AND "tenantId" = ${tenantId}
  `;
  if (result !== 1) {
    throw new Error(`Invariant violation: locked credential parent "${credentialId}" was not touched`);
  }
}

async function classifyFinaliseFailure(
  tx: Prisma.TransactionClient,
  input: FinaliseStatusChangeInput,
): Promise<Exclude<FinaliseStatusChangeOutcome, 'finalised'>> {
  const current = await tx.credentialStatusEntry.findFirst({
    where: { id: input.entryId, credentialId: input.credentialId, tenantId: input.tenantId },
    select: { version: true, pendingToken: true },
  });
  if (current === null) return 'missing';
  if (current.pendingToken === input.token && current.version !== input.expectedVersion) return 'version_conflict';
  return 'token_mismatch';
}

/** Finalises only the reservation identified by both its token and version. */
export async function finaliseStatusChange(
  tx: Prisma.TransactionClient,
  input: FinaliseStatusChangeInput,
): Promise<FinaliseStatusChangeOutcome> {
  const parentLocked = await lockLibraryRecordForUpdate(tx, input.credentialId, input.tenantId);
  if (!parentLocked) return classifyFinaliseFailure(tx, input);
  if (!(await lockStatusServiceInstance(tx, input.instanceId, input.tenantId))) {
    return 'instance_missing';
  }

  const result = await tx.$executeRaw`
    UPDATE "CredentialStatusEntry"
       SET "value" = ${input.value},
           "observedAt" = ${input.observedAt},
           "valueChangedAt" = CASE
             WHEN "value" IS DISTINCT FROM ${input.value} THEN ${input.observedAt}
             ELSE "valueChangedAt"
           END,
           "version" = "version" + 1,
           "pendingValue" = NULL,
           "pendingSince" = NULL,
           "pendingDeadline" = NULL,
           "pendingToken" = NULL,
           "pendingInstanceId" = NULL,
           "pendingConfigDigest" = NULL,
           "acceptedReplacementDigest" = NULL,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = ${input.entryId}
       AND "credentialId" = ${input.credentialId}
       AND "tenantId" = ${input.tenantId}
       AND "pendingToken" = ${input.token}
       AND "version" = ${input.expectedVersion}
  `;
  if (result !== 1) return classifyFinaliseFailure(tx, input);
  await touchCredentialRecord(tx, input.credentialId, input.tenantId);
  return 'finalised';
}

/** Clears only the pending intent owned by the supplied token. */
export async function clearPendingIntent(
  tx: Prisma.TransactionClient,
  input: { entryId: string; credentialId: string; tenantId: string; token: string },
): Promise<ClearPendingIntentOutcome> {
  const parentLocked = await lockLibraryRecordForUpdate(tx, input.credentialId, input.tenantId);
  if (!parentLocked) return 'missing';
  const inspected = await tx.credentialStatusEntry.findFirst({
    where: { id: input.entryId, credentialId: input.credentialId, tenantId: input.tenantId },
    select: { pendingInstanceId: true, pendingToken: true },
  });
  if (!inspected) return 'missing';
  if (inspected.pendingToken === null) return 'already_cleared';
  if (inspected.pendingToken !== input.token) return 'token_mismatch';
  if (
    inspected.pendingInstanceId === null ||
    !(await lockStatusServiceInstance(tx, inspected.pendingInstanceId, input.tenantId))
  )
    return 'instance_missing';
  const result = await tx.$executeRaw`
    UPDATE "CredentialStatusEntry"
       SET "pendingValue" = NULL,
           "pendingSince" = NULL,
           "pendingDeadline" = NULL,
           "pendingToken" = NULL,
           "pendingInstanceId" = NULL,
           "pendingConfigDigest" = NULL,
           "acceptedReplacementDigest" = NULL,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = ${input.entryId}
       AND "credentialId" = ${input.credentialId}
       AND "tenantId" = ${input.tenantId}
       AND "pendingToken" = ${input.token}
  `;
  if (result === 1) {
    await touchCredentialRecord(tx, input.credentialId, input.tenantId);
    return 'cleared';
  }

  const current = await tx.credentialStatusEntry.findFirst({
    where: { id: input.entryId, credentialId: input.credentialId, tenantId: input.tenantId },
    select: { pendingToken: true },
  });
  if (current === null) return 'missing';
  return current.pendingToken === null ? 'already_cleared' : 'token_mismatch';
}

async function classifyObservationFailure(
  tx: Prisma.TransactionClient,
  input: PersistObservationWithoutPendingInput,
): Promise<Exclude<PersistObservationWithoutPendingOutcome, 'persisted'>> {
  const current = await tx.credentialStatusEntry.findFirst({
    where: { id: input.entryId, credentialId: input.credentialId, tenantId: input.tenantId },
    select: { version: true, pendingToken: true },
  });
  if (current === null) return 'missing';
  return current.pendingToken !== null ? 'pending_exists' : 'version_conflict';
}

/** Persists an observation only while no pending intent exists. */
export async function persistObservationWithoutPending(
  tx: Prisma.TransactionClient,
  input: PersistObservationWithoutPendingInput,
): Promise<PersistObservationWithoutPendingOutcome> {
  const parentLocked = await lockLibraryRecordForUpdate(tx, input.credentialId, input.tenantId);
  if (!parentLocked) return classifyObservationFailure(tx, input);
  if (!(await lockStatusServiceInstance(tx, input.instanceId, input.tenantId))) {
    return 'instance_missing';
  }

  const result = await tx.$executeRaw`
    UPDATE "CredentialStatusEntry"
       SET "value" = ${input.value},
           "observedAt" = ${input.observedAt},
           "valueChangedAt" = CASE
             WHEN "value" IS DISTINCT FROM ${input.value} THEN ${input.observedAt}
             ELSE "valueChangedAt"
           END,
           "version" = "version" + 1,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = ${input.entryId}
       AND "credentialId" = ${input.credentialId}
       AND "tenantId" = ${input.tenantId}
       AND "version" = ${input.expectedVersion}
       AND "pendingToken" IS NULL
  `;
  if (result !== 1) return classifyObservationFailure(tx, input);
  await touchCredentialRecord(tx, input.credentialId, input.tenantId);
  return 'persisted';
}

function instanceEntryScope(instanceId: string, tenantId: string) {
  return Prisma.sql`
    entry."pendingInstanceId" = ${instanceId}
    AND entry."pendingToken" IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM "ServiceInstance" AS instance
       WHERE instance."id" = entry."pendingInstanceId"
         AND (
           instance."tenantId" = ${SYSTEM_TENANT_ID}
           OR (instance."tenantId" = ${tenantId} AND entry."tenantId" = ${tenantId})
         )
    )
  `;
}

/**
 * Records a repaired effective config while the caller holds the instance row
 * lock. Tenant-owned instances update only entry rows for that tenant. A
 * system instance intentionally spans every tenant, matching service-instance
 * reads' `OR [{ tenantId }, { SYSTEM_TENANT_ID }]` convention. The live count
 * is checked first so a repair cannot replace a digest while a reservation's
 * deadline is still live. Callers must hold locks in this order: parent (if
 * any) -> ServiceInstance row -> these entry writes; never entry -> instance.
 */
export async function recordAcceptedReplacementDigest(
  tx: Prisma.TransactionClient,
  input: { instanceId: string; tenantId: string; digest: string },
): Promise<{ outcome: 'live_reservation'; live: number } | { outcome: 'recorded'; updated: number }> {
  // This assertion makes the helper safe when called directly. Callers that
  // already hold the row lock acquire the same lock idempotently in this
  // transaction before reading or writing pending entries.
  if (!(await lockServiceInstanceForUpdate(tx, input.instanceId, input.tenantId))) {
    return { outcome: 'recorded', updated: 0 };
  }
  const scope = instanceEntryScope(input.instanceId, input.tenantId);
  const liveRows = await tx.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
      FROM "CredentialStatusEntry" AS entry
     WHERE ${scope}
       AND entry."pendingDeadline" >= CURRENT_TIMESTAMP
  `;
  const live = liveRows[0]?.count ?? 0;
  if (live > 0) return { outcome: 'live_reservation', live };

  const updated = await tx.$executeRaw`
    UPDATE "CredentialStatusEntry" AS entry
       SET "acceptedReplacementDigest" = ${input.digest}, "updatedAt" = CURRENT_TIMESTAMP
     WHERE ${scope}
  `;
  return { outcome: 'recorded', updated };
}

/**
 * Counts pending intents pinned to a tenant-owned or system-owned instance.
 * Entry rows are scoped by the owning tenant for a tenant-owned instance and
 * by every tenant for the system instance, using the same OR convention as
 * service-instance resolution. The caller must already hold the instance row
 * lock. Callers must hold locks in this order: parent (if any) ->
 * ServiceInstance row -> this entry read; never entry -> instance.
 */
export async function countPendingEntriesForInstance(
  tx: Prisma.TransactionClient,
  instanceId: string,
  tenantId: string,
): Promise<number> {
  const scope = instanceEntryScope(instanceId, tenantId);
  const rows = await tx.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
      FROM "CredentialStatusEntry" AS entry
     WHERE ${scope}
  `;
  return rows[0]?.count ?? 0;
}

export { CredentialStatusProvenance };

function plainJsonObject(value: unknown): Prisma.InputJsonObject {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('Invariant violation: credential status wire descriptor must be a plain JSON object');
  }
  return value as Prisma.InputJsonObject;
}
