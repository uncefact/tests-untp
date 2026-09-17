import { randomUUID } from 'node:crypto';
import { VcStatusSetError, VcStatusEntryUnsupportedError } from '@uncefact/untp-ri-services';
import { ConflictError, UnprocessableError } from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
import { prisma } from '@/lib/prisma/prisma';
import { isTransactionDeadlock } from '@/lib/prisma/db-errors';
import { lockLibraryRecordForUpdate } from '@/lib/prisma/repositories/library-record.repository';
import {
  clearPendingIntent,
  finaliseStatusChange,
  reserveStatusChange,
  getCredentialStatusEntry,
} from '@/lib/prisma/repositories/credential-status-entry.repository';
import {
  StatusListLockLostError,
  StatusListMutexBusyError,
  StatusListMutexTimeoutError,
  withStatusListMutex,
} from '@/lib/services/status-list-mutex';
import { readStatusOperationBudgetMs } from '@/lib/config/credential-status.config';
import { SUPPORTED_STATUS_PURPOSES } from './status-purposes';
import { CredentialStatusError, statusFailureMessage, statusReadFailure } from './credential-status-error';
import {
  assertPendingToken,
  checkedStatusObservation,
  loadStatusRecord,
  lockStatusProvider,
  revalidateStatusProvider,
  managementEntry,
  requireStatusAttribution,
  requireStatusVersion,
  selectStatusEntry,
  statusDeadline,
  statusObservationResponse,
  applicationObservationAt,
  type ApplicationClock,
  type StatusRecord,
} from './credential-status-context';
import type { CredentialStatusEntry } from '@/lib/prisma/generated';

const logger = apiLogger.child({ module: 'set-credential-status' });

export type SetCredentialStatusRequest = {
  recordId: string;
  tenantId: string;
  purpose: string;
  value: boolean;
  ifVersion: string | null;
  now?: ApplicationClock;
};

function assertTransition(entry: CredentialStatusEntry, value: boolean): void {
  if (!(SUPPORTED_STATUS_PURPOSES as readonly string[]).includes(entry.statusPurpose)) {
    throw new UnprocessableError(
      'This status purpose cannot be changed by this service.',
      'STATUS_PURPOSE_UNSUPPORTED',
    );
  }
  const descriptor = entry.descriptor;
  if (
    descriptor &&
    typeof descriptor === 'object' &&
    !Array.isArray(descriptor) &&
    typeof descriptor.statusSize === 'number' &&
    descriptor.statusSize > 1
  ) {
    throw new UnprocessableError('Status entries larger than one bit cannot be changed.', 'STATUS_ENTRY_UNSUPPORTED');
  }
  const index = Number(entry.statusListIndex);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new UnprocessableError(
      'Status entry index cannot be represented exactly as a JavaScript number.',
      'STATUS_ENTRY_UNSUPPORTED',
    );
  }
  if ((entry.statusPurpose === 'revocation' || entry.statusPurpose === 'refresh') && value === false) {
    throw new ConflictError('This status purpose is irreversible and cannot be cleared.', 'STATUS_IRREVERSIBLE');
  }
}

function prepare(record: StatusRecord, input: SetCredentialStatusRequest) {
  const entry = selectStatusEntry(record, input.purpose);
  assertTransition(entry, input.value);
  const version = requireStatusVersion(entry, input.ifVersion);
  const instanceId = requireStatusAttribution(record);
  return { entry, version, instanceId };
}

/**
 * Confirms a requested bit only after a provider observation and a fenced commit.
 * Uncertain provider writes retain durable intent for explicit reconciliation.
 * @see docs/adrs/058-credential-status-is-an-issuer-owned-axis.md
 */
export async function setCredentialStatus(input: SetCredentialStatusRequest) {
  prepare(await loadStatusRecord(input.recordId, input.tenantId), input);
  if (process.env.STATUS_MUTATION_ENABLED !== 'true') {
    throw new CredentialStatusError(
      'STATUS_MUTATION_DISABLED',
      'Status changes are not enabled on this deployment. Contact the operator.',
      503,
    );
  }
  const token = randomUUID();
  const reservation = await prisma.$transaction(async (tx) => {
    if (!(await lockLibraryRecordForUpdate(tx, input.recordId, input.tenantId)))
      throw new CredentialStatusError(
        'STATUS_PERSISTENCE_FAILED',
        'The credential disappeared before reservation. No set was dispatched.',
      );
    const prepared = prepare(await loadStatusRecord(input.recordId, input.tenantId, tx), input);
    const provider = await lockStatusProvider(tx, prepared.instanceId, input.tenantId);
    const result = await reserveStatusChange(tx, {
      entryId: prepared.entry.id,
      credentialId: input.recordId,
      tenantId: input.tenantId,
      expectedVersion: prepared.version,
      value: input.value,
      budgetMs: readStatusOperationBudgetMs(),
      instanceId: prepared.instanceId,
      configDigest: provider.digest,
      token,
    });
    if (typeof result === 'string') {
      if (result === 'version_conflict')
        throw new ConflictError('The supplied If-Version is stale.', 'VERSION_CONFLICT');
      if (result === 'pending_exists' || result === 'pending_expired')
        throw new ConflictError(
          result === 'pending_exists'
            ? `A status change for purpose "${prepared.entry.statusPurpose}" is in progress. The requested operation to set it to ${input.value} must wait for it to complete.`
            : `A status change for purpose "${prepared.entry.statusPurpose}" remains unconfirmed. The requested operation to set it to ${input.value} must be reconciled before another change.`,
          result === 'pending_exists' ? 'STATUS_OPERATION_IN_PROGRESS' : 'STATUS_RECOVERY_REQUIRED',
        );
      throw new CredentialStatusError(
        result === 'instance_missing' ? 'VC_SERVICE_UNAVAILABLE' : 'STATUS_PERSISTENCE_FAILED',
        'The status reservation could not be made. No set was dispatched.',
      );
    }
    return { ...prepared, provider, deadline: result.pendingDeadline };
  });
  const { entry, version, provider } = reservation;
  const budget = statusDeadline(reservation.deadline);
  const identity = { entryId: entry.id, credentialId: input.recordId, tenantId: input.tenantId, token };
  const clearOwnedIntent = async (operationError: unknown): Promise<unknown | undefined> => {
    try {
      const cleared = await prisma.$transaction((tx) => clearPendingIntent(tx, identity));
      if (cleared !== 'cleared') throw new Error(`Pending clear refused: ${cleared}`);
      return undefined;
    } catch (error) {
      logger.warn(
        { err: operationError, clearFailure: error },
        'Credential status failure and reservation clear failure',
      );
      return error;
    }
  };
  const beforeCall = async () => {
    budget.assertTime();
    await assertPendingToken(entry.id, input.tenantId, token);
    budget.assertTime();
  };
  const read = async () => {
    await beforeCall();
    const observation = checkedStatusObservation(
      entry,
      await provider.service.getCredentialStatus({
        statusListIssuer: entry.statusListVcIssuer,
        entry: managementEntry(entry),
        signal: budget.signal,
      }),
    );
    return { ...observation, observedAt: applicationObservationAt(input.now) };
  };
  let observation;
  try {
    observation = await read();
  } catch (error) {
    if (error instanceof CredentialStatusError && error.code === 'STATUS_PERSISTENCE_FAILED') throw error;
    const clearFailure = await clearOwnedIntent(error);
    throw statusReadFailure(error, false, clearFailure, true);
  }
  if (observation.value !== input.value) {
    try {
      await beforeCall();
      await provider.service.setCredentialStatus({
        statusListIssuer: entry.statusListVcIssuer,
        entry: managementEntry(entry),
        value: input.value,
        signal: budget.signal,
        serialise: (key, fn) =>
          withStatusListMutex(
            key,
            () => {
              budget.assertTime();
              return fn();
            },
            budget,
          ),
      });
    } catch (error) {
      if (error instanceof StatusListLockLostError || (error instanceof VcStatusSetError && error.mayHaveApplied)) {
        throw new CredentialStatusError(
          'STATUS_OUTCOME_UNKNOWN',
          'The provider may have applied the change. The pending intent is retained and the previous confirmed value is unchanged. Reconcile after the recovery grace window.',
          503,
          error,
        );
      }
      if (error instanceof CredentialStatusError && error.code === 'STATUS_PERSISTENCE_FAILED') throw error;
      const clearFailure = await clearOwnedIntent(error);
      if (error instanceof StatusListMutexBusyError)
        throw new CredentialStatusError(
          'STATUS_COORDINATION_UNAVAILABLE',
          statusFailureMessage(
            'Status coordination capacity is unavailable. No set was dispatched.',
            clearFailure,
            true,
          ),
          503,
          error,
          undefined,
          clearFailure,
        );
      if (error instanceof StatusListMutexTimeoutError)
        throw new CredentialStatusError(
          'STATUS_LIST_BUSY',
          statusFailureMessage('The status list is busy. No set was dispatched.', clearFailure, true),
          503,
          error,
          undefined,
          clearFailure,
        );
      if (error instanceof VcStatusEntryUnsupportedError || error instanceof CredentialStatusError)
        throw statusReadFailure(error, false, clearFailure, true);
      const providerAnswer = error instanceof Error ? error.message : 'The provider returned an unknown failure';
      throw new CredentialStatusError(
        'VC_SERVICE_UNAVAILABLE',
        statusFailureMessage(
          `The provider refused the change: ${providerAnswer}. The previous confirmed value is unchanged.`,
          clearFailure,
          true,
        ),
        error instanceof VcStatusSetError ? 502 : 503,
        error,
        undefined,
        clearFailure,
      );
    }
    try {
      observation = await read();
    } catch (error) {
      if (error instanceof CredentialStatusError && error.code === 'STATUS_PERSISTENCE_FAILED') throw error;
      throw new CredentialStatusError(
        'STATUS_OUTCOME_UNKNOWN',
        'The set was dispatched, but read-back failed. The pending intent is retained and the previous confirmed value is unchanged. Reconcile after the recovery grace window.',
        503,
        error,
      );
    }
    if (observation.value !== input.value)
      throw new CredentialStatusError(
        'STATUS_OUTCOME_MISMATCH',
        'Read-back differs from the requested value. The pending intent is retained and the previous confirmed value is unchanged. Reconcile after the recovery grace window.',
        503,
        undefined,
        { value: observation.value, observedAt: observation.observedAt },
      );
  }
  let commitRequested = false;
  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockLibraryRecordForUpdate(tx, input.recordId, input.tenantId)))
        throw new CredentialStatusError(
          'STATUS_PERSISTENCE_FAILED',
          'The credential disappeared before the observation could be recorded.',
        );
      const currentProvider = await revalidateStatusProvider(tx, provider.instanceId, input.tenantId);
      const current = await getCredentialStatusEntry(tx, input.recordId, input.tenantId, input.purpose);
      if (!current || current.pendingToken !== token || current.version !== version)
        throw new CredentialStatusError(
          'STATUS_PERSISTENCE_FAILED',
          'The reservation changed. The observation was not recorded by this request. Read the stored status.',
        );
      if (
        provider.digest !== current.pendingConfigDigest ||
        (currentProvider.digest !== current.pendingConfigDigest &&
          currentProvider.digest !== current.acceptedReplacementDigest)
      )
        throw new CredentialStatusError(
          'STATUS_PROVIDER_CHANGED',
          'The status service configuration changed. The pending intent is retained. Contact the operator before reconciliation.',
        );
      const result = await finaliseStatusChange(tx, {
        ...identity,
        expectedVersion: version,
        instanceId: provider.instanceId,
        value: observation.value,
        observedAt: new Date(observation.observedAt),
      });
      if (result !== 'finalised')
        throw new CredentialStatusError(
          'STATUS_PERSISTENCE_FAILED',
          'The observation was not recorded because its reservation changed. Read the stored status.',
        );
      commitRequested = true;
    });
  } catch (error) {
    if (error instanceof CredentialStatusError) throw error;
    const commitUncertain = commitRequested && !isTransactionDeadlock(error);
    throw new CredentialStatusError(
      commitUncertain ? 'STATUS_PERSISTENCE_UNCERTAIN' : 'STATUS_PERSISTENCE_FAILED',
      commitUncertain
        ? 'The provider observation was confirmed, but the database commit acknowledgement was lost. Read GET status to learn which state committed.'
        : 'The provider observation was confirmed, but it could not be recorded. The pending intent is retained for reconciliation.',
      503,
      error,
    );
  }
  return statusObservationResponse(entry, observation);
}
