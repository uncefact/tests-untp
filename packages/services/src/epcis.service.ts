import moment from 'moment';
import { EPCISEventType } from './types/epcis';
import { IdentificationKeyType, LinkType } from './linkResolver.service';
import { fillArray, generateUUID } from './utils/helpers';
import { IProductTransformation } from './epcisEvents/types';

/**
 * Generates a credential payload for an EPCIS transformation service.
 * @param credential The EPCIS credential to transform.
 * @returns An object containing the transformed credential data.
 * @throws An error if the credential is invalid or cannot be transformed.
 */
export const epcisTransformationCrendentialSubject = (
  inputItemList: any[],
  gtins: string[],
  dlrUrl: string,
  productTranformation: IProductTransformation,
) => {
  const detailOfProducts: any = productTranformation.outputItems;
  const outputItemList = gtins.map((gtin) => {
    return {
      itemID: gtin,
      link: `${dlrUrl}/${IdentificationKeyType.gtin}/${gtin}?linkType=${LinkType.certificationLinkType}`,
      name: detailOfProducts[gtin].productClass,
    };
  });

  const countInputItems = fillArray(inputItemList, productTranformation.inputItems);

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
