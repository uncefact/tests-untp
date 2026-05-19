import type { Link } from '../types.js';
import type { StorageRecord } from '../../storage/types.js';
import { constructVerifyURL } from '../../utils/helpers.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type BuildPublishLinksOptions = {
  /** UNTP link relation type for the credential links (defaults to gs1:sustainabilityInfo) */
  linkType?: string;
  /** URL of the machine-readable verification service (omit to skip) */
  machineVerificationUrl?: string;
  /** Base URL of the human-readable verification page (omit to skip) */
  humanVerificationUrl?: string;
};

// ── buildPublishLinks ────────────────────────────────────────────────────────

/**
 * Builds the link set for publishing a credential to an Identity Resolver.
 *
 * Always includes a credential storage URI link (`gs1:sustainabilityInfo`).
 * Optionally prepends a machine verification link and appends a human
 * verification link depending on the provided options.
 *
 * @param storage   - The storage record containing the credential URI and hash.
 * @param linkTitle - Human-readable title for the credential links.
 * @param options   - Optional verification URLs for machine and human verification.
 * @returns Array of 1–3 links: always includes the credential storage URI;
 *          optionally preceded by a machine verification link and followed
 *          by a human verification link.
 */
export function buildPublishLinks(
  storage: StorageRecord,
  linkTitle: string,
  options?: BuildPublishLinksOptions,
): Link[] {
  const links: Link[] = [];
  const credentialLinkType = options?.linkType ?? 'gs1:sustainabilityInfo';

  if (options?.machineVerificationUrl) {
    links.push({
      href: options.machineVerificationUrl,
      rel: 'gs1:verificationService',
      type: 'text/plain',
      title: 'VCKit verify service',
    });
  }

  links.push({
    href: storage.uri,
    rel: credentialLinkType,
    type: 'application/json',
    title: linkTitle,
  });

  if (options?.humanVerificationUrl) {
    links.push({
      href: constructVerifyURL({
        baseUrl: options.humanVerificationUrl,
        uri: storage.uri,
        digestMultibase: storage.digestMultibase,
      }),
      rel: credentialLinkType,
      type: 'text/html',
      title: linkTitle,
    });
  }

  return links;
}
