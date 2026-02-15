/**
 * UNTP Identity Resolver Types
 *
 * Types, constants, enums, and interfaces for IDR (Identity Resolver) services.
 * Follows the same co-location pattern as did-manager/types.ts.
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

/** Service type identifier for Identity Resolver services. */
export const IDR_SERVICE_TYPE = 'IDR' as const;

// ── Enums ──────────────────────────────────────────────────────────────────

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
  /** Authorised auditors */
  Auditor = 'untp:accessRole#Auditor',
}

// ── Link types ─────────────────────────────────────────────────────────────

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
 * @see https://www.iso.org/standard/85540.html (ISO 18975)
 */
export type UNTPLinkExtensions = {
  /** HTTP method required to access the resource (default: GET) */
  method?: 'GET' | 'POST';
  /** Encryption method if the resource is encrypted (e.g., "AES-256-GCM") */
  encryptionMethod?: string;
  /** Access roles required to access the resource */
  accessRole?: AccessRole[];
  /**
   * Regional/market context for the link (e.g., "au", "us", "gb").
   * Used by resolvers to serve region-appropriate responses.
   * @see ISO 18975 context parameter
   */
  context?: string;
  /** Whether this is the default link for its relation type */
  default?: boolean;
};

/**
 * A link to be published to the identity resolver.
 * Combines RFC 9264 link attributes with UNTP-specific extensions.
 */
export type Link = RFC9264Link & UNTPLinkExtensions;

// ── Registration types ─────────────────────────────────────────────────────

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
  /** Registered links with their IDR-assigned link IDs */
  links: Array<{
    idrLinkId: string;
    link: Link;
  }>;
};

/**
 * Options for publishing links to an identity resolver.
 *
 * Only `namespace` is required. All other fields are optional overrides
 * that fall back to the service instance's configured defaults.
 */
export type PublishLinksOptions = {
  /** Namespace for the identifier scheme (e.g., "untp", "gs1") */
  namespace: string;
  /** Human-readable description of the item being registered */
  itemDescription?: string;
  /** IANA language tag override (e.g., "en") — falls back to service config */
  ianaLanguage?: string;
  /** Regional/market context override (e.g., "au") — falls back to service config */
  context?: string;
  /** Default link type override (e.g., "untp:dpp") — falls back to service config */
  defaultLinkType?: string;
  /** Default MIME type override (e.g., "text/html") — falls back to service config */
  defaultMimeType?: string;
  /** Default IANA language override (e.g., "en") — falls back to service config */
  defaultIanaLanguage?: string;
  /** Default context override (e.g., "au") — falls back to service config */
  defaultContext?: string;
  /** Forward query string override — falls back to service config */
  fwqs?: boolean;
};

// ── Resolver description types ─────────────────────────────────────────────

/**
 * Description of a resolver service and its capabilities.
 */
export type ResolverDescription = {
  /** Human-readable name of the resolver */
  name: string;
  /** Link types supported by this resolver */
  supportedLinkTypes: LinkType[];
  /** Additional resolver metadata */
  [key: string]: unknown;
};

/**
 * A link type supported by an identity resolver.
 */
export type LinkType = {
  /** Namespace the link type belongs to (e.g., "untp", "gs1") */
  namespace: string;
  /** Type identifier within the namespace (e.g., "dpp", "dcc") */
  type: string;
  /** Human-readable title for the link type */
  title: string;
  /** Optional description of the link type */
  description?: string;
};

// ── Service interface ──────────────────────────────────────────────────────

/**
 * Service responsible for managing links on an identity resolver.
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
   * @param qualifierPath - Qualifier path for sub-identifiers like lot/serial numbers (default: "/")
   * @param options - Registration options including the required namespace
   * @returns Registration details including the canonical resolver URI and link IDs
   */
  publishLinks(
    identifierScheme: string,
    identifier: string,
    links: Link[],
    qualifierPath: string | undefined,
    options: PublishLinksOptions,
  ): Promise<LinkRegistration>;

  /**
   * Retrieves a single link by its IDR-assigned link ID.
   *
   * @param linkId - The IDR-assigned link identifier
   * @returns The link details
   */
  getLinkById(linkId: string): Promise<Link>;

  /**
   * Updates an existing link on the identity resolver.
   *
   * @param linkId - The IDR-assigned link identifier
   * @param link - Partial link data to update
   * @returns The updated link
   */
  updateLink(linkId: string, link: Partial<Link>): Promise<Link>;

  /**
   * Deletes a link from the identity resolver.
   *
   * @param linkId - The IDR-assigned link identifier
   */
  deleteLink(linkId: string): Promise<void>;

  /**
   * Retrieves the resolver's description and capabilities.
   *
   * @returns The resolver description including supported link types
   */
  getResolverDescription(): Promise<ResolverDescription>;

  /**
   * Lists the link types supported by this resolver.
   *
   * @returns Array of supported link types
   */
  getLinkTypes(): Promise<LinkType[]>;
}
