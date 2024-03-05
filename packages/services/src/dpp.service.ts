import _ from 'lodash';
import { EPCISEventType } from './types/epcis.js';
/**
 * Generates a credential payload for an EPCIS event link.
 * @param gtin The GTIN of the product.
 * @param batchId The batch ID of the product.
 * @param product map the gtin with mock data
 * @param batch map the batchId with mock data.
 * @param linkEpcis The link to the EPCIS event.
 * @returns A Promise that resolves to the credential payload for the EPCIS event link.
 * @throws An error if the credential is invalid or the API request fails.
 */
export const buildDPPCredentialSubject = ({ productItem, linkEpcis }: { productItem: any; linkEpcis: string }) => {
  return {
    product: {
      ...productItem,
    },
    batch: {
      traceabilityInfo: [
        {
          EventReference: linkEpcis,
          EventType: EPCISEventType.Transformation,
        },
      ],
    },
  };
};
