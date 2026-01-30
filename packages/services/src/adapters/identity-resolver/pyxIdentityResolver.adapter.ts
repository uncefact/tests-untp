import type { Link, LinkRegistration, IIdentityResolverService } from '../../interfaces/identityResolverService';

/**
 * Payload for registering links with the Identity Resolver.
 * Matches the IDR's CreateLinkRegistrationDto.
 *
 * @see https://github.com/pyx-industries/pyx-identity-resolver
 */
export interface LinkResolver {
  /** Namespace for the identifier vocabulary (e.g., "untp", "gs1") */
  namespace: string;
  /** Type of identifier (e.g., "abn", "gtin", "lei") */
  identificationKeyType: string;
  /** The identifier value */
  identificationKey: string;
  /** Human-readable description of the item */
  itemDescription: string;
  /** Qualifier path for the identifier (default: "/") */
  qualifierPath: string;
  /** Whether this registration is active */
  active: boolean;
  /** Array of link responses to register */
  responses: LinkResponse[];
}

/**
 * Individual link response in the IDR format.
 * Matches the IDR's Response DTO.
 */
export interface LinkResponse {
  /** Link relation type with namespace prefix (e.g., "untp:dpp") */
  linkType: string;
  /** URL of the linked resource */
  targetUrl: string;
  /** MIME type of the resource (e.g., "application/json") */
  mimeType: string;
  /** Human-readable title for the link */
  title: string;
  /** ISO 639-1 language code (e.g., "en", "de") */
  ianaLanguage: string;
  /** Country/region code (e.g., "us", "au") */
  context: string;
  /** Whether this link response is active */
  active: boolean;
  /** Whether this is the default link type for the identifier */
  defaultLinkType: boolean;
  /** Whether this is the default language */
  defaultIanaLanguage: boolean;
  /** Whether this is the default context/region */
  defaultContext: boolean;
  /** Whether this is the default MIME type */
  defaultMimeType: boolean;
  /** Whether to forward query string to target URL */
  fwqs: boolean;
}

const DEFAULT_LANGUAGE = 'en';
const DEFAULT_MIME_TYPE = 'application/json';
const DEFAULT_CONTEXT = 'au';

/**
 * Configuration for how the adapter maps `link.default` to IDR default flags.
 * These are Pyx IDR implementation-specific options.
 *
 * Note: All flags default to false to avoid accidentally overriding system-wide
 * defaults for the identifier. Setting a default flag to true will make this link
 * the default for ALL links registered against that identifier, not just the links
 * being registered in this call.
 *
 * @see https://pyx-industries.github.io/pyx-identity-resolver/docs/introduction/link_registration/
 */
export interface DefaultFlagsConfig {
  /** Set defaultLinkType flag when link.default is true (default: false) */
  defaultLinkType?: boolean;
  /** Set defaultMimeType flag when link.default is true (default: false) */
  defaultMimeType?: boolean;
  /** Set defaultIanaLanguage flag when link.default is true (default: false) */
  defaultIanaLanguage?: boolean;
  /** Set defaultContext flag when link.default is true (default: false) */
  defaultContext?: boolean;
  /** Forward query string to target URL (default: false) */
  fwqs?: boolean;
}

/**
 * Pyx Identity Resolver adapter implementation.
 * Registers links with a Pyx IDR instance to make them discoverable via identifiers.
 *
 * @see https://github.com/pyx-industries/pyx-identity-resolver
 * @see https://pyx-industries.github.io/pyx-identity-resolver/
 */
export class PyxIdentityResolverAdapter implements IIdentityResolverService {
  readonly baseURL: string;
  readonly headers: Record<string, string>;
  readonly namespace: string;
  readonly linkRegisterPath?: string;
  readonly context: string;
  readonly itemDescription?: string;
  private readonly config: Required<DefaultFlagsConfig>;

  /**
   * Creates an instance of PyxIdentityResolverAdapter.
   *
   * @param baseURL - Base URL for the Pyx identity resolver API
   * @param headers - Headers including Authorization
   * @param namespace - Namespace for identifiers (e.g., "untp", "gs1")
   * @param linkRegisterPath - Path for link registration endpoint (appended to baseURL)
   * @param context - Default context/region when link doesn't specify one (default: 'au')
   * @param itemDescription - Default item description (falls back to first link title if not provided)
   * @param config - Configuration for default flags
   */
  constructor(
    baseURL: string,
    headers: Record<string, string>,
    namespace: string,
    linkRegisterPath?: string,
    context?: string,
    itemDescription?: string,
    config?: DefaultFlagsConfig,
  ) {
    if (!baseURL) {
      throw new Error("Error creating PyxIdentityResolverAdapter. API URL is required.");
    }
    if (!namespace) {
      throw new Error("Error creating PyxIdentityResolverAdapter. namespace is required.");
    }
    if (!headers?.Authorization) {
      throw new Error("Error creating PyxIdentityResolverAdapter. Authorization header is required.");
    }

    this.baseURL = baseURL;
    this.headers = headers;
    this.namespace = namespace;
    this.linkRegisterPath = linkRegisterPath;
    this.context = context ?? DEFAULT_CONTEXT;
    this.itemDescription = itemDescription;
    // Default to false for all default flags to avoid accidentally overriding system-wide defaults.
    this.config = {
      defaultLinkType: config?.defaultLinkType ?? false,
      defaultMimeType: config?.defaultMimeType ?? false,
      defaultIanaLanguage: config?.defaultIanaLanguage ?? false,
      defaultContext: config?.defaultContext ?? false,
      fwqs: config?.fwqs ?? false,
    };
  }

  /**
   * Publishes links for an identifier to the identity resolver.
   *
   * @param identifierScheme - The scheme of the identifier (e.g., "abn", "nzbn", "lei")
   * @param identifier - The identifier value within the scheme
   * @param links - Links to publish for this identifier
   * @param qualifierPath - Qualifier path for sub-identifiers like lot/serial numbers (default: "/")
   * @returns Registration details including the canonical resolver URI
   */
  async publishLinks(
    identifierScheme: string,
    identifier: string,
    links: Link[],
    qualifierPath?: string,
  ): Promise<LinkRegistration> {
    // Validate required parameters
    if (!identifierScheme) {
      throw new Error('Failed to publish links: identifierScheme is required');
    }
    if (!identifier) {
      throw new Error('Failed to publish links: identifier is required');
    }
    if (!links || links.length === 0) {
      throw new Error('Failed to publish links: at least one link is required');
    }

    try {
      // Convert links to the format expected by the link resolver API
      const responses: LinkResponse[] = this.convertLinksToResponses(links, this.namespace);

      // Construct link resolver payload
      const payload: LinkResolver = {
        namespace: this.namespace,
        identificationKey: identifier,
        identificationKeyType: identifierScheme,
        itemDescription: this.itemDescription ?? links[0].title,
        qualifierPath: qualifierPath ?? '/',
        active: true,
        responses,
      };

      // Construct full URL for the identity resolver endpoint
      const url: string = this.linkRegisterPath
        ? new URL(this.linkRegisterPath, this.baseURL.endsWith('/') ? this.baseURL : `${this.baseURL}/`).toString()
        : this.baseURL;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Return the registration details
      return {
        resolverUri: new URL(
          `${this.namespace}/${identifierScheme}/${identifier}`,
          this.baseURL.endsWith('/') ? this.baseURL : `${this.baseURL}/`,
        ).toString(),
        identifierScheme,
        identifier,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to register links with identity resolver: ${error.message}`);
      }
      throw new Error('Failed to register links with identity resolver: Unknown error');
    }
  }

  /**
   * Converts Link[] to the LinkResponse[] format expected by the link resolver API.
   *
   * @param links - Array of links to convert
   * @param namespace - The namespace for link types
   * @returns Array of link responses formatted for the link resolver API
   */
  private convertLinksToResponses(links: Link[], namespace: string): LinkResponse[] {
    return links.map((link) => {
      // Use rel as linkType, prefixing with namespace if not already namespaced
      const linkType = link.rel.includes(':') ? link.rel : `${namespace}:${link.rel}`;
      const ianaLanguage = link.hreflang?.[0] || DEFAULT_LANGUAGE;
      const mimeType = link.type || DEFAULT_MIME_TYPE;
      const context = link.context || this.context;

      // Map link.default to IDR default flags based on adapter configuration
      const isDefault = link.default ?? false;
      const isDefaultLinkType = isDefault && this.config.defaultLinkType;
      const isDefaultMimeType = isDefault && this.config.defaultMimeType;
      const isDefaultIanaLanguage = isDefault && this.config.defaultIanaLanguage;
      const isDefaultContext = isDefault && this.config.defaultContext;

      return {
        linkType,
        targetUrl: link.href,
        mimeType,
        title: link.title,
        ianaLanguage,
        context,
        active: true,
        defaultLinkType: isDefaultLinkType,
        defaultIanaLanguage: isDefaultIanaLanguage,
        defaultContext: isDefaultContext,
        defaultMimeType: isDefaultMimeType,
        fwqs: this.config.fwqs,
      };
    });
  }
}
