import GS1DigitalLinkToolkit from 'GS1_DigitalLink_Resolver_CE/digitallink_toolkit_server/src/GS1DigitalLinkToolkit.js';
import { IdentityProviderStrategy } from './IdentityProvider.js';
import { publicAPI } from '../utils/httpService.js';
import { IDLRAI } from '../epcisEvents/types.js';

export enum GS1ServiceEnum {
  certificationInfo = 'https://gs1.org/voc/certificationInfo',
  verificationService = 'https://gs1.org/voc/verificationService',
  serviceInfo = 'https://gs1.org/voc/serviceInfo',
}

export enum PrimaryAIEnum {
  ITIP = '8006',
  GTIN = '01',
}

const gs1DigitalLinkToolkit = new GS1DigitalLinkToolkit();

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
      const gs1ServiceHost: string = products[0]?.linkset?.[GS1ServiceEnum.serviceInfo]?.[0]?.href;
      if (!gs1ServiceHost) {
        return null;
      }
      
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

  /**
   * This function is used to resolve the identifier and qualifier path from a list of DLR AIs.
   * @param dlrAIs - An array of DLR AI objects. Each object should have 'ai' and 'value' properties.
   * @throws {Error} Will throw an error if the dlrAIs array is empty or if both 01 and 8006 AIs are present as they are primary keys.
   * @returns {Object} An object containing the resolved identifier and qualifier path.
   */
  getLinkResolverIdentifier = (dlrAIs: IDLRAI[]): { identifier: string, qualifierPath: string } => {
    if (!dlrAIs.length) {
      throw new Error('Invalid DLR AIs. At least one DLR AI is required to resolve the identifier.');
    }

    const primaryAIs = Object.values(PrimaryAIEnum) as string[];
    const isDlrAIsInvalid = primaryAIs.every(primaryAI => {
      const AIs = dlrAIs.map(dlrAI => dlrAI.ai);
      return AIs.includes(primaryAI);
    });
    if (isDlrAIsInvalid) {
      throw new Error('Invalid DLR AIs. Both 01 and 8006 are primary keys and cannot be present at the same time.');
    }
  
    const { identifier, qualifierPath } = dlrAIs.reduce((linkResolverIdentifier, currentAI) => {
      if (primaryAIs.includes(currentAI.ai)) {
        linkResolverIdentifier.identifier = currentAI.value;
      } else {
        linkResolverIdentifier.qualifierPath += `/${currentAI.ai}/${currentAI.value}`;
      }
  
      return linkResolverIdentifier;
    }, { identifier: '', qualifierPath: '' });
  
    return { identifier, qualifierPath };
  };
}
