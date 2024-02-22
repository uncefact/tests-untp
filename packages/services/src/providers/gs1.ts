import { SupportedProviderTypesEnum } from '../types/types';
import { publicAPI } from '../utils/httpService';
import { ProviderStrategy } from './ProviderStrategy';

export enum gs1ServiceEnum {
  certificationInfo = 'https://gs1.org/voc/certificationInfo',
  verificationService = 'https://gs1.org/voc/verificationService',
  serviceInfo = 'https://gs1.org/voc/serviceInfo',
}

export class Gs1Provider implements ProviderStrategy {
  private providerType: string;
  private providerUrl: string;
  private code: string | undefined;

  constructor(providerType: string, providerUrl: string) {
    this.providerType = providerType;
    this.providerUrl = providerUrl;
  }

  /**
   * Function to retrieve the DLR URL based on the provided GTIN code and identification provider URL.
   * @param gtinCode The GTIN (Global Trade Item Number) code to fetch the DLR URL.
   * @param identifyProviderUrl The identification provider URL to fetch product data.
   * @returns The DLR (Digital Link Resolver) URL corresponding to the provided GTIN code, or null if not found.
   */
  async getDlrUrl(): Promise<string | null> {
    try {
      if (!this.code) {
        return null;
      }

      const fetchProductPayload = { keys: [this.code] };
      const products: any[] = await publicAPI.post(this.providerUrl, fetchProductPayload);
      if (!products || !products.length) {
        return null;
      }
      // Extract the GS1 service host from the fetched products data
      const gs1ServiceHost: string = products[0]?.linkset?.[gs1ServiceEnum.serviceInfo]?.[0]?.href;
      if (!gs1ServiceHost) {
        return null;
      }
      // Construct and return the DLR URL using the GS1 service host and GTIN code
      const dlrUrl = `${gs1ServiceHost}/gtin/${this.code}?linkType=all`;
      return dlrUrl;
    } catch (error) {
      return null;
    }
  }

  setCode(code: string) {
    this.code = code;
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

  isProviderSupported(): boolean {
    const supportedProviderTypes: string[] = [...new Set(Object.values(SupportedProviderTypesEnum))];
    return supportedProviderTypes.includes(this.providerType);
  }
}
