import type {
  SignedVerifiableCredential,
  StorageResponse,
  PublishResponse,
  LinkResponse
} from './interfaces';

import {
  IIdentityResolverService,
  LinkType,
  MimeType,
} from "./interfaces";

import { privateAPI } from './utils/httpService.js';

export class IdentityResolverService implements IIdentityResolverService {
  async publish(
    namespace: string,
    dlrVerificationPage: string,
    dlrLinkTitle: string,
    dlrAPIKey: string,
    dlrAPIUrl: string,
    linkRegisterPath: string,
    identificationKeyType: string,
    identificationKey: string,
    verificationLinkType: LinkType,
    credential: SignedVerifiableCredential, 
    storage: StorageResponse
  ): Promise<PublishResponse> {
    if (!namespace) {
      throw new Error("Failed to publish credential: namespace is required.")
    }

    if (!dlrVerificationPage) {
      throw new Error("Failed to publish credential: dlrVerificationPage is required.")
    }

    if (!dlrLinkTitle) {
      throw new Error("Failed to publish credential: dlrLinkTitle is required.")
    }

    if (!dlrAPIKey) {
      throw new Error("Failed to publish credential: dlrAPIKey is required.")
    }

    if (!dlrAPIUrl) {
      throw new Error("Failed to publish credential: dlrAPIUrl is required.")
    }

    if (!linkRegisterPath) {
      throw new Error("Failed to publish credential: linkRegisterPath is required.")
    }

    if (!identificationKey) {
      throw new Error("Failed to publish credential: identificationKey is required.")
    }

    if (!identificationKeyType) {
      throw new Error("Failed to publish credential: identificationKeyType is required.")
    }

    // construct responses array
    const responses: LinkResponse[] = this.constructLinkResponses(
      namespace,
      dlrLinkTitle,
      LinkType.sustainabilityInfo,
      verificationLinkType,
      dlrAPIUrl,
      linkRegisterPath,
      dlrVerificationPage
    );

    // construct link resolver
    
    // post 
  }

  private constructLinkResponses(
    namespace: string,
    linkTitle: string,
    linkType: LinkType,
    verificationLinkType: LinkType,
    credentialUrl: string,
    linkRegisterUrl: string,
    verificationPageUrl: string,
  ): LinkResponse[] {
    const baseResponses: LinkResponse[] = [
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
        targetUrl: linkRegisterUrl,
        mimeType: MimeType.textHtml,
        defaultLinkType: true,
        defaultIanaLanguage: true,
        defaultMimeType: true,
      },
    ]

    const responses: LinkResponse[] = [];

    baseResponses.forEach((linkResponse: LinkResponse) => {
      const linkResponseForUS: LinkResponse = {
        ianaLanguage: 'en',
        context: 'us',
        title: linkResponse.linkTitle,
        defaultLinkType: false,
        defaultIanaLanguage: false,
        defaultContext: false,
        defaultMimeType: false,
        fwqs: false,
        active: true,
        ...linkResponse,
      };

      const linkResponseForAU: LinkResponse = {
        ianaLanguage: 'en',
        context: 'au',
        defaultLinkType: false,
        defaultIanaLanguage: false,
        defaultContext: false,
        defaultMimeType: false,
        fwqs: false,
        active: true,
        ...linkResponse,
      };

      responses.push(linkResponseForUS, linkResponseForAU);
    })

    return responses;
  };
}
