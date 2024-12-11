import GS1DigitalLinkToolkit from 'digitallink_toolkit_server/src/GS1DigitalLinkToolkit.js';
import { IDLRAI, MimeTypeEnum } from './types/index.js';
import { GS1ServiceEnum } from './identityProviders/GS1Provider.js';
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
 *    identificationKeyType: '01',
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
  verificationLinkType = 'verificationService',
  certificationLinkType = 'certificationInfo',
  epcisLinkType = 'epcis',
  locationInfo = 'locationInfo',
  registryEntry = 'registryEntry',
  sustainabilityInfo = 'sustainabilityInfo',
  traceability = 'traceability',
  serviceInfo = 'serviceInfo',
}

export enum MimeType {
  textPlain = 'text/plain',
  textHtml = 'text/html',
  applicationJson = 'application/json',
}

export interface ILinkResolver {
  identificationKeyType: string;
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
  linkRegisterPath?: string;

  responseLinkType?: string;
  queryString?: string | null;
}

export interface LinkResolver extends Omit<ILinkResolver, 'identificationKeyNamespace'> {
  namespace: string;
  qualifierPath: string;
  active: boolean;
  responses: LinkResponse[];
}

export interface LinkResponse extends ILinkResponse {
  title: string;
  ianaLanguage: string;
  context: string;
  active: boolean;

  defaultIanaLanguage?: boolean;
  defaultContext?: boolean;
  fwqs?: boolean;
}

export const createLinkResolver = async (arg: ICreateLinkResolver): Promise<string> => {
  const {
    dlrAPIUrl,
    namespace,
    linkRegisterPath = '/api/resolver',
    linkResolver,
    linkResponses,
    qualifierPath,
    responseLinkType = 'all',
  } = arg;

  const params: LinkResolver = constructLinkResolver(namespace, linkResolver, linkResponses, qualifierPath);
  try {
    privateAPI.setBearerTokenAuthorizationHeaders(arg.dlrAPIKey || '');
    await privateAPI.post<string>(`${dlrAPIUrl}${linkRegisterPath}`, params);
    const linkTypeQuery = responseLinkType === 'all' ? 'all' : `${namespace}:${responseLinkType}`;

    const path = qualifierPath.includes('?')
      ? `${qualifierPath}&linkType=${linkTypeQuery}`
      : `${qualifierPath}?linkType=${linkTypeQuery}`;
    return `${dlrAPIUrl}/${namespace}/${linkResolver.identificationKeyType}/${linkResolver.identificationKey}${path}`;
  } catch (error) {
    throw new Error('Error creating link resolver');
  }
};

export const constructLinkResolver = (
  namespace: string,
  linkResolver: ILinkResolver,
  linkResponses: ILinkResponse[],
  qualifierPath: string,
) => {
  const constructedLinkResolver: LinkResolver = {
    namespace: namespace,
    identificationKeyType: linkResolver.identificationKeyType,
    identificationKey: linkResolver.identificationKey,
    itemDescription: linkResolver.itemDescription,
    qualifierPath: qualifierPath ? qualifierPath : '/',
    active: true,
    responses: [],
  };

  linkResponses.forEach((linkResponse: ILinkResponse) => {
    const LinkResponseForUS: LinkResponse = {
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

    const LinkResponseForAU: LinkResponse = {
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

    constructedLinkResolver.responses.push(LinkResponseForUS, LinkResponseForAU);
  });
  return constructedLinkResolver;
};

export const registerLinkResolver = async (
  url: string,
  verifyURL: string,
  identificationKeyType: string,
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
    identificationKeyType,
    identificationKey: identificationKey,
    itemDescription: linkTitle,
  };

  const linkResponses: ILinkResponse[] = [
    {
      linkType: `${namespace}:${LinkType.verificationLinkType}`,
      linkTitle: 'VCKit verify service',
      targetUrl: verificationPage,
      mimeType: MimeType.textPlain,
    },
    {
      linkType: `${namespace}:${linkType}`,
      linkTitle: linkTitle,
      targetUrl: url,
      mimeType: MimeType.applicationJson,
    },
    {
      linkType: `${namespace}:${linkType}`,
      linkTitle: linkTitle,
      targetUrl: verifyURL,
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
    (linkSetItem: any) => linkSetItem[`${rootDlrDomain}/${GS1ServiceEnum.sustainabilityInfo}`],
  );
  if (!certificatePassports) {
    return null;
  }

  // Extract passport infos from certificate passports
  const dlrPassports = certificatePassports[`${rootDlrDomain}/${GS1ServiceEnum.sustainabilityInfo}`];
  if (!dlrPassports) {
    return null;
  }

  // Find DLR passport with MIME type text/html
  const dlrPassport = dlrPassports.find((passportItem: any) => passportItem?.type === MimeTypeEnum.textHtml);
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

/**
 * Retrieves the identifier and qualifier path from a URI.
 *
 * @param {string} uri - The URI.
 * @returns {{ identifier: string, qualifierPath: string }} - An object containing the identifier and qualifier path.
 *
 * How to use:
  try {
    const uri = 'https://idr.com/gs1/01/09359502000010/10/ABC123';
    const { identifier, qualifierPath, elementString } = getLinkResolverIdentifierFromURI(uri);

    console.log('Identifier:', identifier); // 09359502000010
    console.log('Qualifier Path:', qualifierPath); // /10/ABC123
    console.log('Element String:', elementString); // (01)09359502000010(10)ABC123
  } catch (error) {
    console.error(error.message);
  }
 */
export const getLinkResolverIdentifierFromURI = (
  uri: string,
): { identifier: string; qualifierPath: string; elementString: string } => {
  const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();
  const elementString = gs1DigitalLinkToolkit.gs1digitalLinkToGS1elementStrings(uri, true);
  return { elementString, ...getLinkResolverIdentifier(elementString) };
};

export const buildElementString = (ai: any) => {
  const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();
  return gs1DigitalLinkToolkit.buildGS1elementStrings(ai);
};

export const extractFromElementString = (elementString: string) => {
  let preparedElementString = elementString;
  if (!preparedElementString) {
    return {};
  }

  if (!preparedElementString.startsWith('01') && !preparedElementString.startsWith('(01)')) {
    preparedElementString = `(01)${preparedElementString}`;
  }

  const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();
  return gs1DigitalLinkToolkit.extractFromGS1elementStrings(preparedElementString);
};
