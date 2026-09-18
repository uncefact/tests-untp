export const E2E_TAG_PREFIX = 'e2e-';

export function runTag(): string {
  const runId = Cypress.env('RUN_ID');
  if (typeof runId !== 'string' || !/^\d{10,}$/.test(runId)) {
    throw new Error('The Cypress RUN_ID capability must be a numeric run id with at least 10 digits.');
  }
  return `${E2E_TAG_PREFIX}${runId}`;
}

/**
 * A URI the RI returned for a stored copy or a VCKit status list, rewritten so
 * the test runner can fetch it. The RI names copies under the storage base URL
 * it was configured with (`E2E_STORAGE_BASE_URL`), which is an internal
 * address on the compose stack; the runner reaches the same service at
 * `E2E_STORAGE_PUBLIC_BASE_URL`. The VCKit URL is also rewritten from its
 * declared service origin to the declared runner-reachable base URL.
 * Deployed and already runner-reachable URIs are returned unchanged.
 */
export function runnerReachableUri(uri: string): string {
  const internal = String(Cypress.env('STORAGE_BASE_URL')).replace(/\/$/, '');
  const external = String(Cypress.env('STORAGE_PUBLIC_BASE_URL')).replace(/\/$/, '');
  if (uri.startsWith(`${internal}/`)) return `${external}${uri.slice(internal.length)}`;

  const vckitInternal = String(Cypress.env('VCKIT_BASE_URL')).replace(/\/$/, '');
  if (uri.startsWith(`${vckitInternal}/`)) {
    const vckitPublic = String(Cypress.env('VCKIT_PUBLIC_BASE_URL')).replace(/\/$/, '');
    return `${vckitPublic}${uri.slice(vckitInternal.length)}`;
  }

  return uri;
}
