/**
 * UNTP Identity Resolver Types
 *
 * These types model the UN Transparency Protocol's Identity Resolver specification,
 * which extends established standards for link resolution.
 *
 * Base standards:
 * - ISO 18975: Link resolution framework
 * - RFC 9264: Linkset format (returned by resolver queries)
 * - GS1 Digital Link: Inspiration for identifier resolution patterns
 *
 * UNTP extensions:
 * - Decentralised access control (encryption, access roles)
 * - UNTP-specific link relation types (untp:dpp, untp:dcc, untp:dte)
 *
 * @see https://untp.unece.org/docs/specification/IdentityResolver
 * @see https://untp.unece.org/docs/specification/DecentralisedAccessControl
 * @see https://www.iso.org/standard/85540.html
 * @see https://datatracker.ietf.org/doc/rfc9264/
 * @see https://www.gs1.org/standards/gs1-digital-link
 *
 * @example
 * // Publish a public DPP and a restricted DCC for an ABN
 * const links: Link[] = [
 *   {
 *     href: 'https://storage.example.com/dpp-123.json',
 *     rel: 'untp:dpp',
 *     type: 'application/ld+json',
 *     title: 'Digital Product Passport',
 *     hreflang: ['en'],
 *     default: true
 *   },
 *   {
 *     href: 'https://storage.example.com/dcc-456.json',
 *     rel: 'untp:dcc',
 *     type: 'application/ld+json',
 *     title: 'Conformity Certificate',
 *     hreflang: ['en'],
 *     method: 'POST',
 *     encryptionMethod: 'AES-256-GCM',
 *     accessRole: [AccessRole.Auditor]
 *   }
 * ];
 *
 * const registration = await identityResolver.publishLinks('abn', '51824753556', links);
 * // => { resolverUri: 'https://resolver.example.com/abn/51824753556', ... }
 */

/**
 * UNTP access roles for variant-based disclosure.
 *
 * @see https://untp.unece.org/docs/specification/VariantBasedDisclosure
 */
export enum AccessRole {
  /** Public access - any party holding a decryption secret may access */
  Anonymous = 'untp:accessRole#Anonymous',
  /** Business partners and purchasers */
  Customer = 'untp:accessRole#Customer',
  /** Competent authorities */
  Regulator = 'untp:accessRole#Regulator',
  /** Accredited recycling facilities */
  Recycler = 'untp:accessRole#Recycler',
  /** Authorized auditors */
  Auditor = 'untp:accessRole#Auditor',
}

/**
 * RFC 9264 link target attributes.
 *
 * @see https://datatracker.ietf.org/doc/rfc9264/
 */
export type RFC9264Link = {
  /** URL of the linked resource */
  href: string;
  /** Link relation type (e.g., "untp:dpp", "untp:dcc", "untp:dte") */
  rel: string;
  /** IANA Media Type of the target resource (e.g., "application/ld+json") */
  type: string;
  /** Human-readable title for the link */
  title: string;
  /** Language(s) of the target resource (e.g., ["en"], ["en", "de"]) */
  hreflang?: string[];
};

/**
 * UNTP-specific link extensions for decentralised access control.
 *
 * @see https://untp.unece.org/docs/specification/DecentralisedAccessControl
 */
export type UNTPLinkExtensions = {
  /** HTTP method required to access the resource (default: GET) */
  method?: 'GET' | 'POST';
  /** Encryption method if the resource is encrypted (e.g., "AES-256-GCM") */
  encryptionMethod?: string;
  /** Access roles required to access the resource */
  accessRole?: AccessRole[];
  /** Whether this is the default link for its relation type */
  default?: boolean;
};

/**
 * A link to be published to the identity resolver.
 * Combines RFC 9264 link attributes with UNTP-specific extensions.
 */
export type Link = RFC9264Link & UNTPLinkExtensions;

/**
 * Result of publishing links to an identity resolver.
 */
export type LinkRegistration = {
  /** Canonical URI where this identifier can be resolved */
  resolverUri: string;
  /** The identifier scheme (e.g., "abn", "nzbn", "lei") */
  identifierScheme: string;
  /** The identifier value within the scheme */
  identifier: string;
};

/**
 * Service responsible for publishing links to an identity resolver.
 *
 * Identity resolvers allow identifiers (e.g., ABN, NZBN, LEI) to be resolved
 * to their associated resources. When queried, the resolver returns an
 * RFC 9264 compliant linkset.
 *
 * @see https://untp.unece.org/docs/specification/IdentityResolver
 */
export interface IIdentityResolverService {
  /**
   * Publishes links for an identifier to the identity resolver.
   *
   * @param identifierScheme - The scheme of the identifier (e.g., "abn", "nzbn", "lei")
   * @param identifier - The identifier value within the scheme
   * @param links - Links to publish for this identifier
   * @returns Registration details including the canonical resolver URI
   */
  publishLinks(identifierScheme: string, identifier: string, links: Link[]): Promise<LinkRegistration>;
}
