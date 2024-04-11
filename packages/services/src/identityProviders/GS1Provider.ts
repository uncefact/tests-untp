import GS1DigitalLinkToolkit from 'digiatllink_toolkit_server/src/GS1DigitalLinkToolkit.js';
import { IdentityProviderStrategy } from './IdentityProvider.js';

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
  getDlrUrl(code: string, providerUrl: string): string | null {
    try {
      const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();
      const gs1DigitalLink = gs1DigitalLinkToolkit.gs1ElementStringsToGS1DigitalLink(code, true, providerUrl);
      return gs1DigitalLink;
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
    const isGTINFormat = formatName.includes('EAN');
    if (isGTINFormat) {
      return `010${decodedText}`;
    }

    return decodedText;
  }

}
