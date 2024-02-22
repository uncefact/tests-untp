import { MimeTypeEnum } from '../types/types.js';
import { publicAPI } from '../utils/httpService.js';

export enum gs1ServiceEnum {
  certificationInfo = 'https://gs1.org/voc/certificationInfo',
  verificationService = 'https://gs1.org/voc/verificationService',
  serviceInfo = 'https://gs1.org/voc/serviceInfo',
}

/**
 * Function to retrieve the DLR URL based on the provided GTIN code and identification provider URL.
 * @param gtinCode The GTIN (Global Trade Item Number) code to fetch the DLR URL.
 * @param identifyProviderUrl The identification provider URL to fetch product data.
 * @returns The DLR (Digital Link Resolver) URL corresponding to the provided GTIN code, or null if not found.
 */
export async function getDlrUrl(gtinCode: string, identifyProviderUrl: string) {
  try {
    // Construct payload for fetching product data
    const fetchProductPayload = { keys: [gtinCode] };

    // Fetch products data from the identification provider
    const products: any[] = await publicAPI.post(identifyProviderUrl, fetchProductPayload);

    // If no products or empty products array, return null
    if (!products || !products.length) {
      return null;
    }

    // Extract the GS1 service host from the fetched products data
    const gs1ServiceHost: string = products[0]?.linkset?.[gs1ServiceEnum.serviceInfo]?.[0]?.href;

    // If GS1 service host is not found, return null
    if (!gs1ServiceHost) {
      return null;
    }

    // Construct and return the DLR URL using the GS1 service host and GTIN code
    const dlrUrl = `${gs1ServiceHost}/gtin/${gtinCode}?linkType=all`;
    return dlrUrl;
  } catch (error) {
    // Return null in case of any errors
    return null;
  }
}

/**
 * Function to fetch the DLR passport data from the provided DLR URL.
 * @param dlrUrl The DLR URL from which to fetch the passport data.
 * @returns The DLR passport data if found, otherwise returns null.
 */
export const getDlrPassport = async (dlrUrl: string): Promise<any | null> => {
  // Fetch DLR data from the provided DLR URL
  const dlrData = await publicAPI.get(dlrUrl);

  // If no DLR data, return null
  if (!dlrData) {
    return null;
  }

  // Find certificate passports in the DLR data
  const certificatePassports = dlrData?.linkset?.find((linkSetItem: any) => linkSetItem[gs1ServiceEnum.certificationInfo]);

  // If no certificate passports found, return null
  if (!certificatePassports) {
    return null;
  }

  // Extract passport infos from certificate passports
  const passportInfos = certificatePassports[gs1ServiceEnum.certificationInfo];

  // If no passport infos found, return null
  if (!passportInfos) {
    return null;
  }

  // Find DLR passport with MIME type application/json
  const dlrPassport = passportInfos.find((passportInfo: any) => passportInfo?.type === MimeTypeEnum.applicationJson);

  // If no DLR passport found, return null
  if (!dlrPassport) {
    return null;
  }

  // Return the found DLR passport
  return dlrPassport;
};

/**
 * Function to extract the GTIN code from the decoded text based on the format name.
 * @param decodedText The decoded text containing the GTIN code.
 * @param formatName The format name of the decoded text.
 * @returns The extracted GTIN code.
 */
export const getGtinCode = (decodedText: string, formatName: string) => {
  // If format name is DATA_MATRIX, slice the decoded text to get GTIN code
  if (formatName === 'DATA_MATRIX') {
    return decodedText.slice(2, 16);
  }

  // If decoded text length is less than 14, prefix '0' to the decoded text
  if (decodedText.length < 14) {
    return `0${decodedText}`;
  }

  // Otherwise, return the decoded text as GTIN code
  return decodedText;
};
