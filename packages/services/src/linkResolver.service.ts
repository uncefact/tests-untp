import GS1DigitalLinkToolkit from 'GS1_DigitalLink_Resolver_CE/digitallink_toolkit_server/src/GS1DigitalLinkToolkit.js';
import { IDLRAI } from './epcisEvents/types.js';
import { GS1ServiceEnum } from './identityProviders/GS1Provider.js';
import { MimeTypeEnum } from './types/types.js';
import { privateAPI } from './utils/httpService.js';
import { extractDomain } from './utils/helpers.js';
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
  identificationKeyNamespace: string;
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
  namespace: string;

  responseLinkType?: string;
  queryString?: string | null;
}

export interface GS1LinkResolver extends Omit<ILinkResolver, 'identificationKeyNamespace'> {
  namespace: string;
  qualifierPath: string;
  active: boolean;
  responses: GS1LinkResponse[];
}

export interface GS1LinkResponse extends ILinkResponse {
  title: string;
  ianaLanguage: string;
  context: string;
  active: boolean;

  defaultIanaLanguage?: boolean;
  defaultContext?: boolean;
  fwqs?: boolean;
}

export const createLinkResolver = async (arg: ICreateLinkResolver): Promise<string> => {
  const { dlrAPIUrl, namespace, linkResolver, linkResponses, qualifierPath, responseLinkType = 'all' } = arg;
  let registerQualifierPath = qualifierPath;
  if (arg.queryString) {
    registerQualifierPath = qualifierPath.includes('?')
      ? `${qualifierPath}&${arg.queryString}`
      : `${qualifierPath}?${arg.queryString}`;
  }
  const params: GS1LinkResolver = constructLinkResolver(linkResolver, linkResponses, qualifierPath);
  try {
    privateAPI.setBearerTokenAuthorizationHeaders(arg.dlrAPIKey || '');
    await privateAPI.post<string>(`${dlrAPIUrl}/api/resolver`, params);

    const path =
      responseLinkType === 'all'
        ? '?linkType=all'
        : qualifierPath.includes('?')
          ? `${qualifierPath}&linkType=${responseLinkType}`
          : `${qualifierPath}?linkType=${responseLinkType}`;
    return `${dlrAPIUrl}/${namespace}/${linkResolver.identificationKeyType}/${linkResolver.identificationKey}${path}`;
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
    namespace: linkResolver.identificationKeyNamespace,
    identificationKeyType: linkResolver.identificationKeyType,
    identificationKey: linkResolver.identificationKey,
    itemDescription: linkResolver.itemDescription,
    qualifierPath: qualifierPath ? qualifierPath : '/',
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
      title: linkResponse.linkTitle,
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
      title: linkResponse.linkTitle,
      ...linkResponse,
    };

    gs1LinkResolver.responses.push(gs1LinkResponseForUS, gs1LinkResponseForAU);
  });
  return gs1LinkResolver;
};

export const registerLinkResolver = async (
  url: string,
  identificationKeyNamespace: string,
  identificationKeyType: IdentificationKeyType,
  identificationKey: string,
  linkTitle: string,
  linkType: LinkType,
  verificationPage: string,
  dlrAPIUrl: string,
  dlrAPIKey: string,
  namespace: string,
  qualifierPath?: string,
  responseLinkType?: string,
) => {
  const linkResolver: ILinkResolver = {
    identificationKeyNamespace,
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
      linkType: linkType,
      linkTitle: linkTitle,
      targetUrl: url,
      mimeType: MimeType.applicationJson,
    },
    {
      linkType: linkType,
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
    namespace,
    linkResolver,
    linkResponses,
    queryString,
    dlrAPIKey,
    qualifierPath: qualifierPath ?? '/',
    responseLinkType,
  });
};
/**
 * Function to fetch the DLR passport data from the provided DLR URL.
 * @param dlrUrl The DLR URL from which to fetch the passport data.
 * @returns The DLR passport data if found, otherwise returns null.
 */
export const getDlrPassport = async <T>(dlrUrl: string): Promise<T | null> => {
  const rootDlrDomain = extractDomain(dlrUrl);

  // Fetch DLR data from the provided DLR URL
  const dlrData = await privateAPI.get(dlrUrl);
  if (!dlrData) {
    return null;
  }

  // Find certificate passports in the DLR data
  const certificatePassports = dlrData?.linkset?.find(
    (linkSetItem: any) => linkSetItem[`${rootDlrDomain}/${GS1ServiceEnum.certificationInfo}`],
  );
  if (!certificatePassports) {
    return null;
  }

  // Extract passport infos from certificate passports
  const dlrPassports = certificatePassports[`${rootDlrDomain}/${GS1ServiceEnum.certificationInfo}`];
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

/**
 * Retrieves the identifier and qualifier path from a GS1 element string.
 * This method will convert either a bracketed element string or an unbracketed element string into an associative array.
 * Input could be "(01)05412345000013(3103)000189(3923)2172(10)ABC123";
 * or input could be "3103000189010541234500001339232172"+groupSeparator+"10ABC123";
 * 
 * @param {string} elementString - The GS1 element string.
 * @returns {{ identifier: string, qualifierPath: string }} - An object containing the identifier and qualifier path.
 * @throws {Error} Throws an error if the element string contains more or less than one primary identification key.
 * 
 * How to use:
  try {
    const elementString = '(01)09359502000010(10)ABC123';
    const { identifier, qualifierPath } = getLinkResolverIdentifier(elementString);

    console.log('Identifier:', identifier);
    console.log('Qualifier Path:', qualifierPath);
  } catch (error) {
    console.error(error.message);
  }
 */
export const getLinkResolverIdentifier = (elementString: string): { identifier: string; qualifierPath: string } => {
  // Instantiate GS1DigitalLinkToolkit to utilize its methods
  const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();

  // Extract AI values from the GS1 element string
  const dlrAIValues = gs1DigitalLinkToolkit.extractFromGS1elementStrings(elementString);
  // Get the list of AIs present in the element string
  const dlrAIs = Object.keys(dlrAIValues);

  // Initialize arrays to store identifier AIs, qualifier AIs, and query strings
  const { identifierAIs, qualifierAIs, queryStrings } = dlrAIs.reduce(
    (result, currentAI) => {
      // Verify syntax and check digit for each AI
      gs1DigitalLinkToolkit.verifySyntax(currentAI, dlrAIValues[currentAI]);
      gs1DigitalLinkToolkit.verifyCheckDigit(currentAI, dlrAIValues[currentAI]);

      // Categorize AIs into identifier AIs, qualifier AIs, and query strings
      if (gs1DigitalLinkToolkit.aiMaps.identifiers.includes(currentAI)) {
        result.identifierAIs.push({ ai: currentAI, value: dlrAIValues[currentAI] });
      } else if (gs1DigitalLinkToolkit.aiMaps.qualifiers.includes(currentAI)) {
        result.qualifierAIs.push({ ai: currentAI, value: dlrAIValues[currentAI] });
      } else {
        const queryString = `${currentAI}=${gs1DigitalLinkToolkit.percentEncode(dlrAIValues[currentAI]) as string}`;
        result.queryStrings.push(queryString);
      }

      return result;
    },
    { identifierAIs: [] as IDLRAI[], qualifierAIs: [] as IDLRAI[], queryStrings: [] as string[] },
  );

  // Ensure that there is exactly one primary identification key
  if (identifierAIs.length !== 1) {
    throw new Error(
      'getLinkResolverIdentifier Error: ===> analyseuri ERROR ===> ' +
        `The element string should contain exactly one primary identification key - it contained ${
          identifierAIs.length
        } ${JSON.stringify(identifierAIs)}; please check for a syntax error.`,
    );
  }

  // Retrieve the primary identifier AI
  const primaryIdentifierAI = identifierAIs[0];
  // Get the qualifier AIs associated with the primary identifier AI
  const primaryQualifierAIs = (gs1DigitalLinkToolkit.aiQualifiers[primaryIdentifierAI.ai] as string[]) || [];
  // Iterate over primary qualifier AIs to construct the qualifier path
  const path = primaryQualifierAIs.reduce((result, primaryQualifierAI) => {
    const validQualifierAI = qualifierAIs.find((qualifier) => qualifier.ai === primaryQualifierAI) as IDLRAI;
    if (validQualifierAI) {
      result += `/${primaryQualifierAI}/${gs1DigitalLinkToolkit.percentEncode(validQualifierAI.value) as string}`;
    }

    return result;
  }, '');

  // Concatenate the qualifier path and query strings
  const combinedQueryString = queryStrings.length ? `?${queryStrings.join('&')}` : '';
  const qualifierPath = path + combinedQueryString;

  // Construct the URI stem using the primary identifier AI and qualifier path
  const uriStem = `/${primaryIdentifierAI.ai}/${primaryIdentifierAI.value}${qualifierPath}`;
  // Verify the constructed URI stem
  gs1DigitalLinkToolkit.analyseURI(uriStem, true);

  return {
    identifier: primaryIdentifierAI.value,
    qualifierPath,
  };
};

export const buildElementString = (ai: any) => {
  const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();
  return gs1DigitalLinkToolkit.buildGS1elementStrings(ai);
};

export const extractFromElementString = (elementString: string) => {
  const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();
  return gs1DigitalLinkToolkit.extractFromGS1elementStrings(elementString);
};
