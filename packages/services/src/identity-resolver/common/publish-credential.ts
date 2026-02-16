import type { Link, LinkRegistration, IIdentityResolverService } from '../types.js';
import type { StorageRecord } from '../../storage/types.js';
import type { UNTPVerifiableCredential } from '../../verifiable-credential/types.js';
import { constructVerifyURL } from '../../utils/helpers.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type BuildPublishLinksOptions = {
  /** URL of the machine-readable verification service (omit to skip) */
  machineVerificationUrl?: string;
  /** Base URL of the human-readable verification page (omit to skip) */
  humanVerificationUrl?: string;
};

export type PublishCredentialOptions = {
  /** Namespace for the identifier scheme (e.g., "gs1", "untp") */
  namespace: string;
  /** Identifier scheme code (e.g., "01" for GS1 GTIN) */
  identifierScheme: string;
  /** Verification URLs for link building */
  verificationUrls?: BuildPublishLinksOptions;
};

export type PublishCredentialResult = {
  enabled: boolean;
  registration?: LinkRegistration;
};

// ── buildPublishLinks ────────────────────────────────────────────────────────

/**
 * Builds the link set for publishing a credential to an Identity Resolver.
 *
 * @param storage - The storage record containing the credential URI and hash
 * @param linkTitle - Human-readable title for the credential links
 * @param options - Optional verification URLs for machine and human verification
 * @returns Array of links to register with the IDR
 */
export function buildPublishLinks(
  storage: StorageRecord,
  linkTitle: string,
  options?: BuildPublishLinksOptions,
): Link[] {
  const links: Link[] = [];

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
    rel: 'gs1:sustainabilityInfo',
    type: 'application/json',
    title: linkTitle,
  });

  if (options?.humanVerificationUrl) {
    links.push({
      href: constructVerifyURL({
        baseUrl: options.humanVerificationUrl,
        uri: storage.uri,
        hash: storage.hash,
      }),
      rel: 'gs1:sustainabilityInfo',
      type: 'text/html',
      title: linkTitle,
    });
  }

  return links;
}

// TODO: Review implementation once the credential type mapper service is created.

// ── publishCredential ────────────────────────────────────────────────────────

/**
 * Publishes a credential to an Identity Resolver.
 *
 * Extracts the identifier and link title from the decoded credential,
 * builds the appropriate link set, and registers the links with the
 * provided IDR service.
 *
 * @param idrService - An already-resolved Identity Resolver service instance
 * @param decodedCredential - The decoded (unsigned) verifiable credential
 * @param storage - The storage record from storing the signed credential
 * @param options - Publishing configuration (namespace, identifier scheme, verification URLs)
 * @returns The publish result including the link registration
 */
export async function publishCredential(
  idrService: IIdentityResolverService,
  decodedCredential: UNTPVerifiableCredential,
  storage: StorageRecord,
  options: PublishCredentialOptions,
): Promise<PublishCredentialResult> {
  if (!storage?.uri) throw new Error('Storage response missing uri');
  if (!storage?.hash) throw new Error('Storage response missing hash');

  const subject = (decodedCredential as Record<string, unknown>).credentialSubject as
    | Record<string, unknown>
    | undefined;
  const identifier = subject?.registeredId as string | undefined;

  if (!identifier) {
    throw new Error('Missing credentialSubject.registeredId — cannot publish');
  }

  const linkTitle = (decodedCredential.type as string[] | undefined)?.[1] ?? 'Product Passport';

  const links = buildPublishLinks(storage, linkTitle, options.verificationUrls);

  const registration = await idrService.publishLinks(options.identifierScheme, identifier, links, '/', {
    namespace: options.namespace,
    itemDescription: linkTitle,
  });

  return { enabled: true, registration };
}
