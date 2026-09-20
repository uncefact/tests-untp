import { appLogger } from '@/lib/api/logger';
import { prisma } from '@/lib/prisma/prisma';
import { readStatusOperationBudgetMs } from '@/lib/config/credential-status.config';
import { CredentialStatusError, statusReadFailure } from './credential-status-error';
import {
  checkedStatusObservation,
  applicationObservationAt,
  loadStatusRecord,
  lockStatusProvider,
  managementEntry,
  statusDeadline,
} from './credential-status-context';
import { statusFactsOf } from '@/lib/library/credential-record-projection';

const logger = appLogger.child({ module: 'read-credential-status' });

/** Returns stored facts; fresh reads are observations only and never resolve pending intent (ADR-058). */
export async function readCredentialStatus(input: { recordId: string; tenantId: string; fresh?: boolean }) {
  const record = await loadStatusRecord(input.recordId, input.tenantId);
  const facts = statusFactsOf(record);
  const result = {
    capture: facts.capture,
    statusCaptureError: facts.statusCaptureError,
    attribution:
      record.vcServiceInstanceId === null
        ? null
        : {
            instanceId: record.vcServiceInstanceId,
            source: record.vcServiceAttribution,
            at: record.vcServiceAttributedAt?.toISOString() ?? null,
          },
    entries: facts.entries.map(({ entryId, statusPurpose, value, observedAt, valueChangedAt, version, pending }) => ({
      entryId,
      statusPurpose,
      value,
      observedAt,
      valueChangedAt,
      version,
      pending,
    })),
  };
  if (!input.fresh) return result;
  const observed: Array<{ entryId: string; statusPurpose: string; value: boolean; observedAt: string }> = [];
  const failures: Array<{ entryId: string; statusPurpose: string; code: string; message: string }> = [];
  const budget = statusDeadline(new Date(Date.now() + readStatusOperationBudgetMs()));
  for (const entry of record.statusEntries) {
    try {
      const instanceId = entry.pendingInstanceId ?? record.vcServiceInstanceId;
      if (!instanceId)
        throw new CredentialStatusError(
          'STATUS_METADATA_UNAVAILABLE',
          'The issuing service is not attributed. Ask the operator to attribute it before a fresh read.',
          409,
        );
      budget.assertTime();
      const provider = await prisma.$transaction((tx) => lockStatusProvider(tx, instanceId, input.tenantId));
      budget.assertTime();
      const observation = checkedStatusObservation(
        entry,
        await provider.service.getCredentialStatus({
          statusListIssuer: entry.statusListVcIssuer,
          entry: managementEntry(entry),
          signal: budget.signal,
        }),
      );
      observed.push({
        entryId: entry.id,
        statusPurpose: entry.statusPurpose,
        value: observation.value,
        observedAt: applicationObservationAt(),
      });
    } catch (error) {
      logger.warn({ err: error, recordId: input.recordId, entryId: entry.id }, 'Fresh credential status read failed');
      const failure = statusReadFailure(error);
      failures.push({
        entryId: entry.id,
        statusPurpose: entry.statusPurpose,
        code: 'code' in failure && typeof failure.code === 'string' ? failure.code : 'VC_SERVICE_UNAVAILABLE',
        message: failure.message,
      });
    }
  }
  return { ...result, observed, failures };
}
