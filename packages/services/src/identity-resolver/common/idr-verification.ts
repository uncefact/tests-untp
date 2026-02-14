import type { ResolverDescription, LinkType } from '../../interfaces/identityResolverService.js';

const REQUIRED_UNTP_LINK_TYPES = ['untp:dpp', 'untp:dcc', 'untp:dte', 'untp:idr'];

export type VerificationWarning = {
  type: 'missing_link_type';
  message: string;
};

/**
 * Verifies that a resolver description has the minimum required fields.
 *
 * @param description - The resolver description to verify
 * @returns true if the description is valid
 */
export function verifyResolverDescription(description: ResolverDescription): boolean {
  return typeof description.name === 'string' && description.name.length > 0;
}

/**
 * Checks that a resolver supports all required UNTP link types.
 * Returns warnings for any missing types — the caller decides
 * whether to treat these as errors or informational messages.
 *
 * @param linkTypes - The link types reported by the resolver
 * @returns Array of warnings for missing required link types
 */
export function verifyUntpLinkTypes(linkTypes: LinkType[]): VerificationWarning[] {
  const warnings: VerificationWarning[] = [];
  const availableTypes = linkTypes.map((lt) => `${lt.namespace}:${lt.type}`);

  for (const required of REQUIRED_UNTP_LINK_TYPES) {
    if (!availableTypes.includes(required)) {
      warnings.push({
        type: 'missing_link_type',
        message: `Required UNTP link type "${required}" is not registered on this IDR service`,
      });
    }
  }

  return warnings;
}
