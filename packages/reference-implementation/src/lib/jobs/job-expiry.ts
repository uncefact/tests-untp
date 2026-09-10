/** The queue's expiry ceiling in seconds, kept apart from the adapter so configuration validation does not load pg-boss. */
export const MAX_JOB_EXPIRE_SECONDS = 24 * 60 * 60;
