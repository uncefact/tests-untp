import type { Link, LinkRegistration, IIdentityResolverService, PublishLinksOptions } from '../../interfaces/identityResolverService';

/**
 * Payload for registering links with the Identity Resolver.
 * Matches the IDR's CreateLinkRegistrationDto.
 *
 * @see https://github.com/pyx-industries/pyx-identity-resolver
 */
interface LinkResolver {
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
interface LinkResponse {
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
 * Pyx-specific options for publishing links, extending the base options.
 * These are request-specific values that must be provided for each publishLinks call.
 */
export interface PyxPublishLinksOptions extends PublishLinksOptions {
  /**
   * Namespace for the identifier vocabulary (e.g., "untp", "gs1").
   * Required for each request.
   */
  namespace: string;
  /**
   * Default regional/market context for links that don't specify one (e.g., "au", "us").
   * Individual links can override this via their `context` property.
   */
  context?: string;
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
  private readonly config: Required<DefaultFlagsConfig>;

  /**
   * Creates an instance of PyxIdentityResolverAdapter.
   *
   * @param baseURL - Base URL for the Pyx identity resolver API
   * @param headers - Headers including Authorization
   * @param config - Configuration for default flags
   */
  constructor(
    baseURL: string,
    headers: Record<string, string>,
    config?: DefaultFlagsConfig,
  ) {
    if (!baseURL) {
      throw new Error("Error creating PyxIdentityResolverAdapter. API URL is required.");
    }
    if (!headers?.Authorization) {
      throw new Error("Error creating PyxIdentityResolverAdapter. Authorization header is required.");
    }

    this.baseURL = baseURL;
    this.headers = headers;
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
   * @param options - Required options including namespace, and optional itemDescription and context
   * @returns Registration details including the canonical resolver URI
   */
  async publishLinks(
    identifierScheme: string,
    identifier: string,
    links: Link[],
    qualifierPath?: string,
    options?: PyxPublishLinksOptions,
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
    if (!options?.namespace) {
      throw new Error('Failed to publish links: options.namespace is required');
    }

    // Extract options
    const namespace = options.namespace;
    const context = options.context ?? DEFAULT_CONTEXT;
    const itemDescription = options.itemDescription ?? links[0].title;

    try {
      // Convert links to the format expected by the link resolver API
      const responses: LinkResponse[] = this.convertLinksToResponses(links, namespace, context);

      // Construct link resolver payload
      const payload: LinkResolver = {
        namespace,
        identificationKey: identifier,
        identificationKeyType: identifierScheme,
        itemDescription,
        qualifierPath: qualifierPath ?? '/',
        active: true,
        responses,
      };

      const response = await fetch(`${this.baseURL}/resolver`, {
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
      const qualifiers = qualifierPath && qualifierPath !== '/' ? `/${qualifierPath}` : '';
      return {
        resolverUri: new URL(
          `${namespace}/${identifierScheme}/${identifier}${qualifiers}`,
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
   * @param defaultContext - The default context to use when link doesn't specify one
   * @returns Array of link responses formatted for the link resolver API
   */
  private convertLinksToResponses(links: Link[], namespace: string, defaultContext: string): LinkResponse[] {
    return links.map((link) => {
      // Use rel as linkType, prefixing with namespace if not already namespaced
      const linkType = link.rel.includes(':') ? link.rel : `${namespace}:${link.rel}`;
      const ianaLanguage = link.hreflang?.[0] || DEFAULT_LANGUAGE;
      const mimeType = link.type || DEFAULT_MIME_TYPE;
      const context = link.context || defaultContext;

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
