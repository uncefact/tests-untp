import GS1DigitalLinkToolkit from 'digiatllink_toolkit_server/src/GS1DigitalLinkToolkit.js';
import { IdentityProviderStrategy } from './IdentityProvider.js';
import { publicAPI } from '../utils/httpService.js';

export enum GS1ServiceEnum {
  certificationInfo = 'https://gs1.org/voc/certificationInfo',
  verificationService = 'https://gs1.org/voc/verificationService',
  serviceInfo = 'https://gs1.org/voc/serviceInfo',
}

export class GS1Provider implements IdentityProviderStrategy {
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
      const [product] = products;
      const gs1ServiceHost: string = product?.linkset?.[GS1ServiceEnum.serviceInfo]?.[0]?.href;
      if (!gs1ServiceHost) {
        return null;
      }
      const isGTINFormat = Object.keys(product).includes('gtin');
      const elementStrings = isGTINFormat ? `01${code}` : code;
      
      const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();
      const gs1DigitalLink = gs1DigitalLinkToolkit.gs1ElementStringsToGS1DigitalLink(elementStrings, true, gs1ServiceHost);

      const dlrUrl = new URL(gs1DigitalLink);
      dlrUrl.searchParams.append('linkType', 'all');

      return dlrUrl.toString();
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
