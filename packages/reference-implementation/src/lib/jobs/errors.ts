import { StructuredError } from '@uncefact/untp-utils';

/**
 * Thrown for misuse or misconfiguration of the job queue itself: contradictory
 * queue declarations, registration after start, duplicate registrations.
 * Infrastructure failures from the underlying store propagate as-is.
 */
export class JobQueueError extends StructuredError {}
