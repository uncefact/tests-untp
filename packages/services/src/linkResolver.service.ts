import { GS1ServiceEnum } from './identityProviders/GS1Provider.js';
import { MimeTypeEnum } from './types/types.js';
import { privateAPI } from './utils/httpService.js';

/**
 * Generates a link resolver URL based on the provided AgtraceLinkResolver and AgtraceLinkResponse objects.
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

  linkResponses.forEach((agtraceLinkResponse: ILinkResponse) => {
    const gs1LinkResponseForUS: GS1LinkResponse = {
      ianaLanguage: 'en',
      context: 'us',
      defaultLinkType: false,
      defaultIanaLanguage: false,
      defaultContext: false,
      defaultMimeType: false,
      fwqs: false,
      active: true,
      ...agtraceLinkResponse,
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
      ...agtraceLinkResponse,
    };

    gs1LinkResolver.responses.push(gs1LinkResponseForUS, gs1LinkResponseForAU);
  });
  return gs1LinkResolver;
};

/**
 * Function to fetch the DLR passport data from the provided DLR URL.
 * @param dlrUrl The DLR URL from which to fetch the passport data.
 * @returns The DLR passport data if found, otherwise returns null.
 */
export const getDlrPassport = async <T>(dlrUrl: string): Promise<T | null> => {
  // Fetch DLR data from the provided DLR URL
  const dlrData = await privateAPI.get(dlrUrl);
  if (!dlrData) {
    return null;
  }

  // Find certificate passports in the DLR data
  const certificatePassports = dlrData?.linkset?.find(
    (linkSetItem: any) => linkSetItem[GS1ServiceEnum.certificationInfo],
  );
  if (!certificatePassports) {
    return null;
  }

  // Extract passport infos from certificate passports
  const dlrPassports = certificatePassports[GS1ServiceEnum.certificationInfo];
  if (!dlrPassports) {
    return null;
  }

  // Find DLR passport with MIME type application/json
  const dlrPassport = dlrPassports.find((passportItem: any) => passportItem?.type === MimeTypeEnum.applicationJson);
  if (!dlrPassport) {
    return null;
  }

  // Return the found DLR passport
  return dlrPassport;
};
