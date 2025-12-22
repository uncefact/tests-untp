import type {
  PublishResponse,
  LinkResponse,
  BaseLinkResponse,
  PublishCredentialParams,
} from './interfaces/identityResolverService';

import {
  IIdentityResolverService,
  LinkType,
  MimeType,
} from './interfaces/identityResolverService';

import type { LinkResolver } from './linkResolver.service';

import { privateAPI } from './utils/httpService.js';

export const locales = ['us', 'au'];

/**
 * Implementation of the Identity Resolver Service.
 * Registers credential links with an identity resolver to make them discoverable via identifiers.
 */
export class IdentityResolverService implements IIdentityResolverService {

  /**
   * Publishes a credential to the identity resolver, making it discoverable via the identifier.
   * This registers the association between the identifier and the credential link.
   *
   * @param params - The parameters for publishing the credential
   * @returns A promise that resolves to the publish response
   * @throws Error if validation fails or the registration fails
   */
  async publish(params: PublishCredentialParams): Promise<PublishResponse> {
    // Validate required parameters
    this.validateParams(params);

    // Set defaults for optional parameters
    const {
      namespace,
      identificationKeyType,
      identificationKey,
      credentialUrl,
      verificationPage,
      linkTitle,
      linkType,
      qualifierPath = '/',
      verificationLinkType = LinkType.verificationLinkType,
      apiUrl,
      apiKey,
      linkRegisterPath = '',
    } = params;

    try {
      // Construct responses array for different locales
      const responses: LinkResponse[] = this.constructLinkResponses(
        namespace,
        linkTitle,
        linkType,
        verificationLinkType,
        credentialUrl,
        verificationPage,
      );

      // Construct link resolver payload
      const payload: LinkResolver = {
        namespace,
        identificationKey,
        identificationKeyType,
        itemDescription: linkTitle,
        qualifierPath,
        active: true,
        responses,
      };

      // Construct full URL for the identity resolver endpoint
      const url: string = linkRegisterPath
        ? `${apiUrl}/${linkRegisterPath}`
        : apiUrl;

      // Set authorization and make the API call
      privateAPI.setBearerTokenAuthorizationHeaders(apiKey);
      const response = await privateAPI.post<PublishResponse>(url, payload);

      return { enabled: true, raw: response } as PublishResponse;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to register credential with identity resolver for identifier ${identificationKey}: ${errorMessage}`);
      }
      throw new Error(`Failed to register credential with identity resolver for identifier ${identificationKey}: Unknown error`);
    }
  }

  /**
   * Validates the required parameters for publishing a credential.
   *
   * @param params - The parameters to validate
   * @throws Error if any required parameter is missing
   */
  private validateParams(params: PublishCredentialParams): void {
    const requiredFields: (keyof PublishCredentialParams)[] = [
      'namespace',
      'identificationKeyType',
      'identificationKey',
      'credentialUrl',
      'verificationPage',
      'linkTitle',
      'apiUrl',
      'apiKey',
    ];

    for (const field of requiredFields) {
      if (!params[field]) {
        throw new Error(`Failed to publish credential: ${field} is required.`);
      }
    }
  }

  /**
   * Constructs link responses for different locales and link types.
   * Creates responses for verification service and credential access.
   *
   * @param namespace - The namespace for the identifier
   * @param linkTitle - The title for the link
   * @param linkType - The type of link for the credential
   * @param verificationLinkType - The type of link for verification
   * @param credentialUrl - The URL where the credential can be accessed
   * @param verificationPageUrl - The URL of the verification page
   * @returns Array of link responses for different locales
   */
  private constructLinkResponses(
    namespace: string,
    linkTitle: string,
    linkType: LinkType,
    verificationLinkType: LinkType,
    credentialUrl: string,
    verificationPageUrl: string,
  ): LinkResponse[] {
    const baseResponses: BaseLinkResponse[] = [
      {
        linkType: `${namespace}:${verificationLinkType}`,
        linkTitle: 'VCKit verify service',
        targetUrl: verificationPageUrl,
        mimeType: MimeType.textPlain,
      },
      {
        linkType: `${namespace}:${linkType}`,
        linkTitle: linkTitle,
        targetUrl: credentialUrl,
        mimeType: MimeType.applicationJson,
      },
      {
        linkType: `${namespace}:${linkType}`,
        linkTitle: linkTitle,
        targetUrl: credentialUrl,
        mimeType: MimeType.textHtml,
        defaultLinkType: true,
        defaultIanaLanguage: true,
        defaultMimeType: true,
      },
    ];

    const responses: LinkResponse[] = [];

    // Create link responses for each configured locale
    baseResponses.forEach((linkResponse: BaseLinkResponse) => {
      for (const locale of locales) {
        const localizedResponse: LinkResponse = {
          ...linkResponse,
          title: linkResponse.linkTitle,
          ianaLanguage: 'en',
          context: locale,
          defaultLinkType: linkResponse.defaultLinkType ?? false,
          defaultIanaLanguage: linkResponse.defaultIanaLanguage ?? false,
          defaultContext: false,
          defaultMimeType: linkResponse.defaultMimeType ?? false,
          fwqs: false,
          active: true,
        };

        responses.push(localizedResponse);
      }
    });

    return responses;
  }
}
