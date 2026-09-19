/**
 * The names of the queues this application sends to, kept here so the queue
 * infrastructure can create them at start without reaching into the domain
 * modules that own their handlers. A handler module imports its name from
 * here; the queue singleton declares every name at start.
 */

/** Generation-1 verification of a registered external credential (#955). */
export const LIBRARY_VERIFY_JOB = 'library.verify-generation';

/** Scheduled reconciliation of pending verification generations (#957). */
export const LIBRARY_RECONCILE_PENDING_RUNS_JOB = 'library.reconcile-pending-runs';

/** Scheduled deletion of retained credential batch item data. */
export const CREDENTIAL_BATCH_EXPIRY_JOB = 'credentials.expire-batches';

/** Sequential issuance of the items in one credential batch (#663, ADR-060). */
export const CREDENTIAL_BATCH_ISSUE_JOB = 'credentials.issue-batch';

/** Scheduled recovery of unfinished credential batches whose queue job vanished. */
export const CREDENTIAL_BATCH_RECONCILE_JOB = 'credentials.reconcile-batches';

export const SENDING_QUEUES = [LIBRARY_VERIFY_JOB, CREDENTIAL_BATCH_ISSUE_JOB] as const;
