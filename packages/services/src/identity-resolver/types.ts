/**
 * Identity Resolver Types
 *
 * Types, constants, and identifiers for IDR (Identity Resolver) services.
 * Follows the same pattern as did-manager/types.ts.
 */

/** Service type identifier for Identity Resolver services. */
export const IDR_SERVICE_TYPE = 'IDR' as const;

/**
 * Thrown when an IDR link ID references a link that no longer exists on the
 * upstream identity resolver (HTTP 404 or 410). This indicates a
 * desynchronisation between our local LinkRegistration records and the IDR.
 */
export class IdrLinkNotFoundError extends Error {
  constructor(
    public readonly linkId: string,
    public readonly httpStatus?: number,
  ) {
    super(`IDR link "${linkId}" not found on upstream resolver (HTTP ${httpStatus ?? 'unknown'})`);
    this.name = 'IdrLinkNotFoundError';
  }
}
