import { publicAPI } from '../utils/httpService.js';
import { IdentityProviderStrategy } from './IdentityProvider.js';

export enum gs1ServiceEnum {
  certificationInfo = 'https://gs1.org/voc/certificationInfo',
  verificationService = 'https://gs1.org/voc/verificationService',
  serviceInfo = 'https://gs1.org/voc/serviceInfo',
}

export class Gs1Provider implements IdentityProviderStrategy {
  /**
   * Function to retrieve the DLR URL based on the GTIN code and identification provider URL.
   * @returns The DLR (Digital Link Resolver) URL corresponding to the provided GTIN code, or null if not found.
   */
  async getDlrUrl(code: string, providerUrl: string): Promise<string | null> {
    try {
      const fetchProductPayload = { keys: [code] };
      const products: any[] = await publicAPI.post(providerUrl, fetchProductPayload);
      if (!products || !products.length) {
        return null;
      }
      // Extract the GS1 service host from the fetched products data
      const gs1ServiceHost: string = products[0]?.linkset?.[gs1ServiceEnum.serviceInfo]?.[0]?.href;
      if (!gs1ServiceHost) {
        return null;
      }
      // Construct and return the DLR URL using the GS1 service host and GTIN code
      const dlrUrl = `${gs1ServiceHost}/gtin/${code}?linkType=all`;
      return dlrUrl;
    } catch (error) {
      return null;
    }
  }

  /**
   * Function to extract the GTIN code from the decoded text based on the format name.
   * @param decodedText The decoded text containing the GTIN code.
   * @param formatName The format name of the decoded text.
   * @returns The extracted GTIN code.
   */
  getCode(decodedText: string, formatName: string): string {
    if (formatName === 'DATA_MATRIX') {
      return decodedText.slice(2, 16);
    }

    if (decodedText.length < 14) {
      return `0${decodedText}`;
    }

    return decodedText;
  }

}
