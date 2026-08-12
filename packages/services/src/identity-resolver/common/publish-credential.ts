import type { AccessRole, Link } from '../types.js';
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
  /**
   * BCP 47 language tags the credential resource is available in. Attached to
   * the credential link only; verification links are not language-specific.
   */
  hreflang?: string[];
  /**
   * Additional link relation types qualifying the credential link beyond its
   * primary `rel`. Attached to the credential link only.
   */
  additionalRels?: string[];
  /**
   * Whether the credential target URL is safe to publish in a public
   * directory. Attached to the credential link only. Unset round-trips
   * distinctly from `false`.
   */
  public?: boolean;
  /**
   * UNTP access roles governing who the published links are surfaced to.
   * Attached to the credential link and the human verification link; the
   * machine verification service link stays role-free.
   */
  accessRole?: AccessRole[];
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
  const accessRole = options?.accessRole && options.accessRole.length > 0 ? { accessRole: options.accessRole } : {};

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
    ...(options?.hreflang && options.hreflang.length > 0 ? { hreflang: options.hreflang } : {}),
    ...(options?.additionalRels && options.additionalRels.length > 0 ? { additionalRels: options.additionalRels } : {}),
    ...(options?.public !== undefined ? { public: options.public } : {}),
    ...accessRole,
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
      ...accessRole,
    });
  }

  return links;
}
