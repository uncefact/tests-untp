const DEFAULT_STALE_CLAIM_MINUTES = 10;
const MINIMUM_STALE_CLAIM_MINUTES = 1;

/**
 * IDEMPOTENCY_STALE_CLAIM_MINUTES is how long a claimed Idempotency-Key may
 * sit unfinished before another request may take it (#954, ADR-051).
 *
 * The right value is a property of the deployment rather than of the code,
 * because it has to outlast the slowest realistic signing and storage round
 * trip on this instance, and neither service is bounded by a timeout here.
 * Set it too low and a request that is merely slow has its key taken, which
 * is how a duplicate credential gets issued. Set it too high and a key
 * belonging to a crashed request stays unusable for longer, with retries
 * answered `409` until it expires. The default of ten minutes is the safer
 * end of that trade for a typical deployment.
 *
 * Unset or blank uses the default. A provided value that is not an integer
 * of at least one minute throws, surfaced at process boot
 * (instrumentation.node.ts), so a misconfigured window fails the container
 * start rather than being discovered when a retry behaves oddly.
 */
export function readStaleClaimMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.IDEMPOTENCY_STALE_CLAIM_MINUTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_STALE_CLAIM_MINUTES * 60_000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MINIMUM_STALE_CLAIM_MINUTES) {
    throw new Error(
      `IDEMPOTENCY_STALE_CLAIM_MINUTES must be an integer of at least ${MINIMUM_STALE_CLAIM_MINUTES} when set; fix or unset it (unset uses ${DEFAULT_STALE_CLAIM_MINUTES}).`,
    );
  }
  return parsed * 60_000;
}

/**
 * Boot-time check (instrumentation.node.ts): parses the value for its side
 * effect only, so a provided-and-invalid one fails startup with the reader's
 * message instead of surfacing on the first retried issuance.
 */
export function validateStaleClaimOnBoot(env: Record<string, string | undefined> = process.env): void {
  readStaleClaimMs(env);
}
