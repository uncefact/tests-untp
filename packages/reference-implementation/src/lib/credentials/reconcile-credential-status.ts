import { ConflictError } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma/prisma';
import { isTransactionDeadlock } from '@/lib/prisma/db-errors';
import { STATUS_RECONCILIATION_IN_PROGRESS_MESSAGE } from './credential-status-messages';
import { lockLibraryRecordForUpdate } from '@/lib/prisma/repositories/library-record.repository';
import {
  finaliseStatusChange,
  persistObservationWithoutPending,
} from '@/lib/prisma/repositories/credential-status-entry.repository';
import { readStatusOperationBudgetMs, readStatusReconcileGraceMs } from '@/lib/config/credential-status.config';
import { CredentialStatusError, statusReadFailure } from './credential-status-error';
import {
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
} from './credential-status-context';

export type ReconcileCredentialStatusRequest = {
  recordId: string;
  tenantId: string;
  purpose: string;
  ifVersion: string | null;
  acceptProviderChange?: boolean;
  now?: ApplicationClock;
};

/**
 * Records a provider observation after the recovery grace window, or the first
 * observation of an entry with no pending intent. A failed read clears nothing.
 * @see docs/adrs/058-credential-status-is-an-issuer-owned-axis.md
 */
export async function reconcileCredentialStatus(input: ReconcileCredentialStatusRequest) {
  const initial = await loadStatusRecord(input.recordId, input.tenantId);
  requireStatusVersion(selectStatusEntry(initial, input.purpose), input.ifVersion);
  const snapshot = await prisma.$transaction(async (tx) => {
    if (!(await lockLibraryRecordForUpdate(tx, input.recordId, input.tenantId)))
      throw new CredentialStatusError('STATUS_PERSISTENCE_FAILED', 'The credential disappeared before reconciliation.');
    const record = await loadStatusRecord(input.recordId, input.tenantId, tx);
    const entry = selectStatusEntry(record, input.purpose);
    const version = requireStatusVersion(entry, input.ifVersion);
    const instanceId = entry.pendingToken === null ? requireStatusAttribution(record) : entry.pendingInstanceId;
    if (!instanceId)
      throw new CredentialStatusError(
        'RECORD_UNREADABLE',
        'The pending status operation has no attributed service. Contact the operator.',
        500,
      );
    if (entry.pendingToken !== null) {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
      if (entry.pendingDeadline === null)
        throw new CredentialStatusError(
          'RECORD_UNREADABLE',
          'The pending status operation has no deadline. Contact the operator.',
          500,
        );
      if (clock.now.getTime() < entry.pendingDeadline.getTime() + readStatusReconcileGraceMs()) {
        throw new ConflictError(STATUS_RECONCILIATION_IN_PROGRESS_MESSAGE, 'STATUS_OPERATION_IN_PROGRESS');
      }
    }
    const provider = await lockStatusProvider(tx, instanceId, input.tenantId);
    if (
      entry.pendingToken !== null &&
      provider.digest !== entry.pendingConfigDigest &&
      input.acceptProviderChange !== true
    ) {
      throw new CredentialStatusError(
        'STATUS_PROVIDER_CHANGED',
        'The attributed provider configuration changed. Confirm its identity before reconciling with acceptProviderChange: true. The pending intent is retained.',
      );
    }
    return { entry, version, provider, attributedInstanceId: record.vcServiceInstanceId };
  });
  const { entry, provider, version } = snapshot;
  const budget = statusDeadline(new Date(Date.now() + readStatusOperationBudgetMs()));
  let observation;
  try {
    budget.assertTime();
    const checked = checkedStatusObservation(
      entry,
      await provider.service.getCredentialStatus({
        statusListIssuer: entry.statusListVcIssuer,
        entry: managementEntry(entry),
        signal: budget.signal,
      }),
    );
    observation = { ...checked, observedAt: applicationObservationAt(input.now) };
  } catch (error) {
    throw statusReadFailure(
      error,
      entry.pendingToken !== null,
      undefined,
      false,
      'Reconciliation could not observe the status. The previous confirmed value and any pending intent are unchanged. Retry reconciliation later.',
    );
  }
  let commitRequested = false;
  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockLibraryRecordForUpdate(tx, input.recordId, input.tenantId)))
        throw new CredentialStatusError(
          'STATUS_PERSISTENCE_FAILED',
          'The credential disappeared before reconciliation could be recorded.',
        );
      const currentRecord = await loadStatusRecord(input.recordId, input.tenantId, tx);
      const current = selectStatusEntry(currentRecord, input.purpose);
      const currentProvider = await revalidateStatusProvider(tx, provider.instanceId, input.tenantId);
      if (
        currentProvider.digest !== provider.digest ||
        (entry.pendingToken === null && currentRecord.vcServiceInstanceId !== snapshot.attributedInstanceId) ||
        (entry.pendingToken !== null && current.pendingInstanceId !== provider.instanceId)
      ) {
        throw new CredentialStatusError(
          'STATUS_PROVIDER_CHANGED',
          'The provider identity changed during reconciliation. No observation was recorded and any pending intent is retained.',
        );
      }
      const common = {
        entryId: entry.id,
        credentialId: input.recordId,
        tenantId: input.tenantId,
        expectedVersion: version,
        value: observation.value,
        observedAt: new Date(observation.observedAt),
        instanceId: provider.instanceId,
      };
      const result =
        entry.pendingToken === null
          ? await persistObservationWithoutPending(tx, common)
          : await finaliseStatusChange(tx, { ...common, token: entry.pendingToken });
      if (result !== 'persisted' && result !== 'finalised')
        throw new CredentialStatusError(
          'STATUS_PERSISTENCE_FAILED',
          'The status entry changed during reconciliation. This observation was not recorded. Read the stored status before acting again.',
        );
      commitRequested = true;
    });
  } catch (error) {
    if (error instanceof CredentialStatusError) throw error;
    const commitUncertain = commitRequested && !isTransactionDeadlock(error);
    throw new CredentialStatusError(
      commitUncertain ? 'STATUS_PERSISTENCE_UNCERTAIN' : 'STATUS_PERSISTENCE_FAILED',
      commitUncertain
        ? 'The reconciliation commit acknowledgement was lost. Read GET status to learn which state committed.'
        : 'The reconciliation observation could not be recorded. The previous confirmed value and any pending intent are unchanged.',
      503,
      error,
    );
  }
  return statusObservationResponse(entry, observation);
}
