/**
 * The names of the queues this application sends to, kept here so the queue
 * infrastructure can create them at start without reaching into the domain
 * modules that own their handlers. A handler module imports its name from
 * here; the queue singleton declares every name at start.
 */

/** Generation-1 verification of a registered external credential (#955). */
export const LIBRARY_VERIFY_JOB = 'library.verify-generation';

export const SENDING_QUEUES = [LIBRARY_VERIFY_JOB] as const;
