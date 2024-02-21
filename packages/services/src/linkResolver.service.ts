import { privateAPI } from './utils/httpService.js';
/**
 * Generates a link resolver URL based on the provided linkResolver and linkResponse objects.
 *
 * @param arg - The arguments for the link resolver.
 *
 * @returns The link resolver URL.
 *
 * @example
 * const arg: ICreateLinkResolver = {
 *  linkResolver: {
 *    identificationKeyType: IdentificationKeyType.nlisid,
 *    identificationKey: '1234',
 *    itemDescription: 'item',
 *  },
 *  linkResponses: [
 *   {
 *     linkType: 'all',
 *     linkTitle: 'title',
 *     targetUrl: 'https://target.com',
 *     mimeType: 'application/json',
 *   },
 * ],
 * qualifierPath: 'qualifier',
 * dlrAPIUrl: 'https://dlr.com',
};
 *
 * const resolverUrl = await createLinkResolver(arg);
 * // Returns: http://localhost/nlisid/3ABCD123XBDC0447?linkType=all
 */

export enum LinkType {
  verificationLinkType = 'gs1:verificationService',
  certificationLinkType = 'gs1:certificationInfo',
  epcisLinkType = 'gs1:epcis',
}

export enum MimeType {
  textPlain = 'text/plain',
  textHtml = 'text/html',
  applicationJson = 'application/json',
}

export enum IdentificationKeyType {
  gtin = 'gtin',
  nlisid = 'nlisid',
  consignment_id = 'consignment_id',
}

export interface ILinkResolver {
  identificationKeyType: IdentificationKeyType;
  identificationKey: string;
  itemDescription: string;
}

export interface ILinkResponse {
  linkType: string;
  linkTitle: string;
  targetUrl: string;
  mimeType: string;

  defaultIanaLanguage?: boolean;
  defaultMimeType?: boolean;
  defaultLinkType?: boolean;
}

export interface ICreateLinkResolver {
  linkResolver: ILinkResolver;
  linkResponses: ILinkResponse[];
  qualifierPath: string;
  dlrAPIUrl: string;
  dlrAPIKey: string;

  responseLinkType?: string;
  queryString?: string | null;
}

export interface GS1LinkResolver extends ILinkResolver {
  qualifierPath: string;
  active: boolean;
  responses: GS1LinkResponse[];
}

export interface GS1LinkResponse extends ILinkResponse {
  ianaLanguage: string;
  context: string;
  active: boolean;

  defaultIanaLanguage?: boolean;
  defaultContext?: boolean;
  fwqs?: boolean;
}

export const createLinkResolver = async (arg: ICreateLinkResolver): Promise<string> => {
  const { dlrAPIUrl, linkResolver, linkResponses, qualifierPath, responseLinkType = 'all' } = arg;
  const registerQualifierPath = arg.queryString ? qualifierPath + '?' + arg.queryString : qualifierPath;
  const params: GS1LinkResolver[] = [constructLinkResolver(linkResolver, linkResponses, registerQualifierPath)];
  try {    
    privateAPI.setBearerTokenAuthorizationHeaders(arg.dlrAPIKey || '');
    await privateAPI.post<string>(`${dlrAPIUrl}/resolver`, params);
    const path = responseLinkType === 'all' ? '?linkType=all' : `${qualifierPath}?linkType=${responseLinkType}`;
    return `${dlrAPIUrl}/${linkResolver.identificationKeyType}/${linkResolver.identificationKey}${path}`;
  } catch (error) {
    throw new Error('Error creating link resolver');
  }
};

export const constructLinkResolver = (
  linkResolver: ILinkResolver,
  linkResponses: ILinkResponse[],
  qualifierPath: string,
) => {
  const gs1LinkResolver: GS1LinkResolver = {
    identificationKeyType: linkResolver.identificationKeyType,
    identificationKey: linkResolver.identificationKey,
    itemDescription: linkResolver.itemDescription,
    qualifierPath,
    active: true,
    responses: [],
  };

  linkResponses.forEach((linkResponse: ILinkResponse) => {
    const gs1LinkResponseForUS: GS1LinkResponse = {
      ianaLanguage: 'en',
      context: 'us',
      defaultLinkType: false,
      defaultIanaLanguage: false,
      defaultContext: false,
      defaultMimeType: false,
      fwqs: false,
      active: true,
      ...linkResponse,
    };

    const gs1LinkResponseForAU: GS1LinkResponse = {
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

    gs1LinkResolver.responses.push(gs1LinkResponseForUS, gs1LinkResponseForAU);
  });
  return gs1LinkResolver;
};

export const registerLinkResolver = async (
  url: string,
  identificationKeyType: IdentificationKeyType,
  identificationKey: string,
  linkTitle: string,
  verificationPage: string,
  dlrAPIUrl: string,
  dlrAPIKey: string,
  qualifierPath?: string,
) => {
  const linkResolver: ILinkResolver = {
    identificationKeyType,
    identificationKey: identificationKey,
    itemDescription: linkTitle,
  };
  const query = encodeURIComponent(JSON.stringify({ payload: { uri: url } }));
  const queryString = `q=${query}`;
  const verificationPassportPage = `${verificationPage}/?${queryString}`;
  const linkResponses: ILinkResponse[] = [
    {
      linkType: LinkType.verificationLinkType,
      linkTitle: 'VCKit verify service',
      targetUrl: verificationPage,
      mimeType: MimeType.textPlain,
    },
    {
      linkType: LinkType.certificationLinkType,
      linkTitle: linkTitle,
      targetUrl: url,
      mimeType: MimeType.applicationJson,
    },
    {
      linkType: LinkType.certificationLinkType,
      linkTitle: linkTitle,
      targetUrl: verificationPassportPage,
      mimeType: MimeType.textHtml,
      defaultLinkType: true,
      defaultIanaLanguage: true,
      defaultMimeType: true,
    },
  ];  

  return await createLinkResolver({
    dlrAPIUrl,
    linkResolver,
    linkResponses,
    queryString,
    dlrAPIKey,
    qualifierPath: qualifierPath ?? '/',
  });
};
