/**
 * Credential status refusal messages, shared by the throw sites and the Swagger
 * error-example allowlist (`src/lib/swagger/error-examples.ts`). Reword a message
 * here only; the published examples derive from these exports, so a copy left in
 * either place would drift from what the code throws.
 */
export const STATUS_PENDING_READ_NOTICE = 'The pending intent is unchanged and retrying will not help.';

export const STATUS_METADATA_UNAVAILABLE_MESSAGE =
  'Status metadata is unavailable. Ask the operator to run pnpm backfill:credential-status-entries, using --retry-failed for a retryable capture failure.';

export const STATUS_PURPOSE_UNSUPPORTED_MESSAGE = 'This status purpose cannot be changed by this service.';

export function statusOperationInProgressMessage(purpose: string, value: boolean): string {
  return `A status change for purpose "${purpose}" is in progress. The requested operation to set it to ${value} must wait for it to complete.`;
}

export function statusRecoveryRequiredMessage(purpose: string, value: boolean): string {
  return `A status change for purpose "${purpose}" remains unconfirmed. The requested operation to set it to ${value} must be reconciled before another change.`;
}

export function statusEntryNotFoundMessage(purpose: string): string {
  return `The credential has no status entry for purpose "${purpose}".`;
}

export const STATUS_RECONCILIATION_IN_PROGRESS_MESSAGE =
  'The status operation and its recovery grace window have not ended. Retry reconciliation later.';

export function statusEntryUnsupportedMessage(pendingKept = false): string {
  return pendingKept
    ? `The status entry cannot be represented by this service. ${STATUS_PENDING_READ_NOTICE}`
    : 'The status entry cannot be represented by this service.';
}

export function statusInvalidObservationMessage(pendingKept = false): string {
  return pendingKept
    ? `The status service returned an invalid observation. No status change was confirmed. ${STATUS_PENDING_READ_NOTICE}`
    : 'The status service returned an invalid observation. No status change was confirmed.';
}

export function credentialDeleteStatusOperationMessage(
  credentialId: string,
  statusPurposes: readonly string[],
): string {
  const count = statusPurposes.length;
  return `Cannot delete credential "${credentialId}" while ${count} pending status operation${count === 1 ? '' : 's'} ${
    count === 1 ? 'remains' : 'remain'
  } for purposes: ${statusPurposes.join(
    ', ',
  )}. Wait for the pending status operations to complete, or have an operator reconcile them.`;
}
