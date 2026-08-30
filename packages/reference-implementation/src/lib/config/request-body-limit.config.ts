const DEFAULT_MAX_REQUEST_BODY_BYTES = 5_242_880;
const MINIMUM_MAX_REQUEST_BODY_BYTES = 1024;

/**
 * MAX_REQUEST_BODY_BYTES caps how many request-body bytes
 * `readRequestBytes` will hold (#954). `parseRequestBody` uses that reader
 * for every real request, so the cap applies to every request body the API
 * accepts. A credential payload is normally tens of kilobytes. The existing
 * `VERIFY_MAX_CREDENTIAL_SIZE` bound on a fetched credential is 10 MB. 5 MiB
 * leaves ample room for a large multi-event payload while bounding what an
 * unauthenticated-body-shaped attack can make the process hold.
 *
 * Unset or blank uses the default. A provided value that is not an integer
 * of at least 1024 throws, surfaced at process boot
 * (instrumentation.node.ts), so a misconfigured cap fails the container
 * start instead of silently running with a different bound.
 */
export function readMaxRequestBodyBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MAX_REQUEST_BODY_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_REQUEST_BODY_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MINIMUM_MAX_REQUEST_BODY_BYTES) {
    throw new Error(
      `MAX_REQUEST_BODY_BYTES must be an integer of at least ${MINIMUM_MAX_REQUEST_BODY_BYTES} when set; fix or unset it (unset uses ${DEFAULT_MAX_REQUEST_BODY_BYTES}).`,
    );
  }
  return parsed;
}

/**
 * Boot-time check (instrumentation.node.ts): parses MAX_REQUEST_BODY_BYTES
 * for its side effect only, so a provided-and-invalid value fails startup
 * with the reader's message instead of surfacing on the first oversized
 * request.
 */
export function validateMaxRequestBodyBytesOnBoot(env: Record<string, string | undefined> = process.env): void {
  readMaxRequestBodyBytes(env);
}
