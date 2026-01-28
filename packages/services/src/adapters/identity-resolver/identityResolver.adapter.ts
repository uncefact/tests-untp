import type { Link, LinkRegistration } from '../../interfaces/identityResolverService';
import type { IIdentityResolverService } from '../../interfaces/identityResolverService';
import type { LinkResolver, LinkResponse } from '../../linkResolver.service';

/**
 * Configuration for the Identity Resolver Service.
 */
export interface IdentityResolverConfig {
  apiUrl: string;
  apiKey: string;
  namespace?: string;
  linkRegisterPath?: string;
}

/** Supported locales for link responses */
export const locales = ['us', 'au'];

/**
 * Implementation of the Identity Resolver Service.
 * Registers links with an identity resolver to make them discoverable via identifiers.
 */
export class IdentityResolverService implements IIdentityResolverService {
  private config: IdentityResolverConfig;

  /**
   * Creates an instance of IdentityResolverService.
   *
   * @param config - Configuration for the identity resolver
   */
  constructor(config: IdentityResolverConfig) {
    if (!config.apiUrl || !config.apiKey) {
      throw new Error('IdentityResolverService requires apiUrl and apiKey in configuration');
    }
    this.config = config;
  }

  /**
   * Publishes links for an identifier to the identity resolver.
   *
   * @param identifierScheme - The scheme of the identifier (e.g., "abn", "nzbn", "lei")
   * @param identifier - The identifier value within the scheme
   * @param links - Links to publish for this identifier
   * @returns Registration details including the canonical resolver URI
   * @throws Error if validation fails or the registration fails
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

    const { apiUrl, apiKey, namespace = identifierScheme, linkRegisterPath = '' } = this.config;

    try {
      // Convert links to the format expected by the link resolver API
      const responses: LinkResponse[] = this.convertLinksToResponses(links, namespace);

      // Construct link resolver payload
      const payload: LinkResolver = {
        namespace,
        identificationKey: identifier,
        identificationKeyType: identifierScheme,
        itemDescription: links[0].title,
        qualifierPath: '/',
        active: true,
        responses,
      };

      // Construct full URL for the identity resolver endpoint
      const url: string = linkRegisterPath
        ? new URL(linkRegisterPath, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`).toString()
        : apiUrl;

      // Make the API call
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Return the registration details
      return {
        resolverUri: new URL(`${namespace}/${identifierScheme}/${identifier}`, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`).toString(),
        identifierScheme,
        identifier,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to register links with identity resolver for identifier ${identifier}: ${errorMessage}`,
      );
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
        linkTitle: link.title,
        targetUrl: link.href,
        mimeType: link.type,
        title: link.title,
        ianaLanguage: link.hreflang?.[0] || 'en',
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
