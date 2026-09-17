/**
 * Status purposes offered by the Reference Implementation at its issuance
 * boundary. ADR-058 bounds lifecycle meaning to revocation and suspension:
 * message is refused because the provider treats every set bit as invalidating,
 * while refresh and custom purposes are not offered at issuance in this release.
 */
export const SUPPORTED_STATUS_PURPOSES = ['revocation', 'suspension'] as const;
export type SupportedStatusPurpose = (typeof SUPPORTED_STATUS_PURPOSES)[number];
