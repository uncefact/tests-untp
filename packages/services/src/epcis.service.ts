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
  identifiers: string[],
  dlrUrl: string,
  productTransformation: IProductTransformation,
) => {
  const detailOfProducts: any = productTransformation.outputItems;
  const convertProductToObj = detailOfProducts.reduce((accumulator: any, item: any) => {
    accumulator[item.itemID] = item;
    return accumulator;
  }, {});
  const outputItemList = identifiers.map((identifier) => {
    return {
      itemID: identifier,
      link: `${dlrUrl}/${IdentificationKeyType.gtin}/${identifier}?linkType=${LinkType.certificationLinkType}`,
      name: convertProductToObj[identifier]?.productClass,
    };
  });

  const countInputItems = fillArray(inputItemList, productTransformation.inputItems);

  const inputItems = inputItemList.map((item: string) => {
    return {
      itemID: item,
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
    outputItemList,
  };
};
