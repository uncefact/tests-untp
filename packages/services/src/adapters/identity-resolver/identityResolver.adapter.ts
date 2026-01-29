import type { Link, LinkRegistration } from '../../interfaces/identityResolverService';
import type { IIdentityResolverService } from '../../interfaces/identityResolverService';

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

/** Supported locales for link responses */
export const locales = ['us', 'au'];
const defaultLanguage = 'en';

/**
 * Implementation of the Identity Resolver Service.
 * Registers links with an identity resolver to make them discoverable via identifiers.
 */
export class IdentityResolverAdapter implements IIdentityResolverService {
  readonly baseURL: string;
  readonly headers: Record<string, string>;
  readonly namespace: string;
  readonly linkRegisterPath?: string;

  /**
   * Creates an instance of IdentityResolverAdapter.
   *
   * @param baseURL - Base URL for the identity resolver API
   * @param headers - Headers including Authorization
   * @param namespace - Optional namespace for identifiers
   * @param linkRegisterPath - Optional path for link registration endpoint
   */
  constructor(
    baseURL: string,
    headers: Record<string, string>,
    namespace: string,
    linkRegisterPath?: string,
  ) {
    if (!baseURL) {
      throw new Error("Error creating IdentityResolverAdapter. API URL is required.");
    }
    if (!namespace) {
      throw new Error("Error creating IdentityResolverAdapter. namespace is required.");
    }
    if (!headers?.Authorization) {
      throw new Error("Error creating IdentityResolverAdapter. Authorization header is required.");
    }

    this.baseURL = baseURL;
    this.headers = headers;
    this.namespace = namespace;
    this.linkRegisterPath = linkRegisterPath;
  }

  /**
   * Publishes links for an identifier to the identity resolver.
   *
   * @param identifierScheme - The scheme of the identifier (e.g., "abn", "nzbn", "lei")
   * @param identifier - The identifier value within the scheme
   * @param links - Links to publish for this identifier
   * @returns Registration details including the canonical resolver URI
   */
  async publishLinks(
    identifierScheme: string,
    identifier: string,
    links: Link[],
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
      const responses: LinkResponse[] = this.convertLinksToResponses(links, namespace);

      // Construct link resolver payload
      const payload: LinkResolver = {
        this.namespace,
        identificationKey: identifier,
        identificationKeyType: identifierScheme,
        itemDescription: links[0].title,
        qualifierPath: '/',
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
          this.baseURL.endsWith('/') ? this.baseURL : `${this.baseURL}/`
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
   * Creates localized responses for each configured locale.
   *
   * @param links - Array of links to convert
   * @param namespace - The namespace for link types
   * @returns Array of link responses formatted for the link resolver API
   */
  private convertLinksToResponses(links: Link[], namespace: string): LinkResponse[] {
    return links.flatMap((link) => {
      const linkType = link.rel.includes(':') ? link.rel : `${namespace}:${link.rel}`;

      return locales.map((locale) => ({
        linkType,
        targetUrl: link.href,
        mimeType: link.type,
        title: link.title,
        ianaLanguage: link.hreflang?.[0] || defaultLanguage,
        context: locale,
        active: true,
        defaultLinkType: link.default ?? false,
        defaultIanaLanguage: link.default ?? false,
        defaultContext: false,
        defaultMimeType: link.default ?? false,
        fwqs: false,
      }));
    });
  }
}
