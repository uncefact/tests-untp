import moment from 'moment';
import { EPCISEventType } from './types/epcis.js';
import { IdentificationKeyType, LinkType } from './linkResolver.service.js';
import { fillArray, generateUUID } from './utils/helpers.js';
import { IProductTransformation } from './epcisEvents/types.js';

/**
 * Generates a credential payload for an EPCIS transformation service.
 * @param credential The EPCIS credential to transform.
 * @returns An object containing the transformed credential data.
 * @throws An error if the credential is invalid or cannot be transformed.
 */
export const epcisTransformationCrendentialSubject = (
  inputItemList: any[],
  dlrUrl: string,
  productTransformation: IProductTransformation,
) => {
  const { outputItems } = productTransformation;

  const countInputItems = fillArray(inputItemList, productTransformation.inputItems);

  const inputItems = inputItemList.map((item: string) => {
    return {
      productID: item,
      link: `${dlrUrl}/${IdentificationKeyType.nlisid}/${item}?linkType=${LinkType.certificationLinkType}`,
    };
  });

  return {
    eventID: generateUUID(),
    eventType: EPCISEventType.Transformation,
    eventTime: moment.utc().format('ddd, D MMM YYYY HH:mm:ss [GMT]'),
    actionCode: 'observe',
    dispositionCode: 'active',
    businessStepCode: 'packing',
    readPointId: generateUUID(),
    locationId: generateUUID(),
    inputItemList: inputItems,
    inputQuantityList: countInputItems.map((item) => ({
      productClass: item.productClass,
      quantity: item.quantity,
      uom: item.uom,
    })),
    outputItems,
  };
};
