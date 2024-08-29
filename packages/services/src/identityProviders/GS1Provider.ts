import GS1DigitalLinkToolkit from 'GS1_DigitalLink_Resolver_CE/digitallink_toolkit_server/src/GS1DigitalLinkToolkit.js';
import { publicAPI } from '../utils/httpService.js';
import { IdentityProviderStrategy } from './IdentityProvider.js';

export enum GS1ServiceEnum {
  certificationInfo = 'voc/certificationInfo',
  verificationService = 'voc/verificationService',
  serviceInfo = 'voc/serviceInfo',
}

export class GS1Provider implements IdentityProviderStrategy {
  /**
   * Function to retrieve the DLR URL based on the GTIN code and identification provider URL.
   * @returns The DLR (Digital Link Resolver) URL corresponding to the provided GTIN code, or null if not found.
   */
  async getDlrUrl(code: string, providerUrl: string, namespace: string): Promise<string | null> {
    const parseGS1Payload = (payload: any) => {
      const aiRegex = /\((\d+)\)([^(]+)/g;
      const parsed = Array.from(payload.matchAll(aiRegex), (match) => [(match as any)[1], (match as any)[2]]);
      return parsed.flat().join('/');
    };

    try {
      const fetchProductPayload = parseGS1Payload(code);

      const extractGTIN = (gs1String: string): string | null => {
        const parts = gs1String.split('/');
        for (let i = 0; i < parts.length; i += 2) {
          if (parts[i] === '01' && i + 1 < parts.length) {
            return `01/${parts[i + 1]}`;
          }
        }
        return null;
      };

      const gtin = extractGTIN(fetchProductPayload);
      if (gtin === null) {
        throw new Error('GTIN not found in the GS1 payload');
      }

      const { linkset }: any = await publicAPI.get(`${providerUrl}/${namespace}/${gtin}?linkType=all`);

      if (!linkset || !linkset.length) {
        return null;
      }

      // Extract the GS1 service host from the fetched products data
      const gs1ServiceHost: string = linkset[0]?.[`${providerUrl}/${GS1ServiceEnum.serviceInfo}`]?.[0]?.href;
      if (!gs1ServiceHost) {
        return null;
      }

      const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();
      const gs1DigitalLink = gs1DigitalLinkToolkit.gs1ElementStringsToGS1DigitalLink(code, true, gs1ServiceHost);

      const dlrUrl = new URL(gs1DigitalLink);
      dlrUrl.searchParams.append('linkType', 'all');

      return dlrUrl.toString();
    } catch (e) {
      const error = e as Error;
      throw new Error(`Failed to run get DLR Url. ${error.message}`);
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
