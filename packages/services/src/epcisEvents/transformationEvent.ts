import { VerifiableCredential } from '@vckit/core-types';

import { issueVC } from '../vckit.service.js';
import { uploadJson } from '../storage.service.js';
import { registerLinkResolver } from '../linkResolver.service.js';
import { epcisTransformationCrendentialSubject } from '../epcis.service.js';

import { IService } from '../types/IService.js';
import {
  IConfigDLR,
  ICredential,
  IProductTransformation,
  IStorageContext,
  ITransformationEvent,
  IVCKitContext,
} from './types';
import { generateUUID, incrementQuality } from '../utils/helpers.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { EPCISEventType } from '../types/epcis.js';

/**
 * Process transformation event, issue epcis transformation event and dpp for each identifiers, then upload to storage and register link resolver for each dpp
 * @param data - data for the transformation event, which nlsids are selected
 * @param context - context for the transformation event, which includes the epcisTransformationEvent, identifiers, dlr, dpp, storage, etc.
 */
export const processTransformationEvent: IService = async (data: any, context: ITransformationEvent): Promise<any> => {
  try {
    const epcisTransformationEventContext = context.epcisTransformationEvent;
    const identifiersContext = context.identifiers;
    const dlrContext = context.dlr;
    const vcKitContext = context.vckit;
    const productTransformation = context.productTransformation;

    const epcisVc = await issueEpcisTransformationEvent(
      vcKitContext,
      epcisTransformationEventContext,
      identifiersContext,
      dlrContext,
      data,
      productTransformation,
      context.identifierKeyPaths,
    );

    const storageContext = context.storage;
    const transformantionEventLink = await uploadVC(
      `epcis-transformation-event/${generateUUID()}`,
      epcisVc,
      storageContext,
    );

    const dppContext = context.dpp;
    await Promise.all(
      identifiersContext.map(async (identifier: string) => {
        const epcisTransformationEventQualifierPath = epcisTransformationEventContext?.dlrQualifierPath;
        const linkResolverContext = context.dlr;

        const transformationEventLinkResolver = await registerLinkResolver(
          transformantionEventLink,
          epcisTransformationEventContext.dlrIdentificationKeyType,
          identifier,
          epcisTransformationEventContext.dlrLinkTitle,
          epcisTransformationEventContext.dlrVerificationPage,
          linkResolverContext.dlrAPIUrl,
          linkResolverContext.dlrAPIKey,
          epcisTransformationEventQualifierPath,
        );

        const dpp = await issueDPP(
          vcKitContext,
          dppContext,
          identifier,
          data?.length,
          transformationEventLinkResolver,
          productTransformation,
          data,
        );
        const DPPLink = await uploadVC(`${identifier}/${generateUUID()}`, dpp, storageContext);

        const dppQualifierPath = dppContext?.dlrQualifierPath;
        await registerLinkResolver(
          DPPLink,
          dppContext.dlrIdentificationKeyType,
          identifier,
          dppContext.dlrLinkTitle,
          dppContext.dlrVerificationPage,
          linkResolverContext.dlrAPIUrl,
          linkResolverContext.dlrAPIKey,
          dppQualifierPath,
        );
      }),
    );
  } catch (error) {
    throw new Error(error);
  }
};

/**
 * Issue epcis transformation event and return the verifiable credential
 * @param vckitContext - context for the vckit to issue vc for epcis transformation event
 * @param identifiersContext - list of identifiers of products
 * @param dlrContext - context for the link resolver to register link resolver for the epcis transformation event
 * @param data - data for the transformation event, which nlsids are selected
 * @returns VerifiableCredential
 */
export const issueEpcisTransformationEvent = async (
  vcKitContext: IVCKitContext,
  epcisTransformationEvent: ICredential,
  identifiersContext: string[],
  dlrContext: IConfigDLR,
  data: any,
  productTransformation: IProductTransformation,
  identifierKeyPaths: string[],
) => {
  const restOfVC = { render: epcisTransformationEvent.renderTemplate };
  const inputIdentifiers = getIdentifierByObjectKeyPaths(data.data, identifierKeyPaths) as string[];
  if (!inputIdentifiers) throw new Error('Input Identifiers not found');

  const epcisVc: VerifiableCredential = await issueVC({
    context: epcisTransformationEvent.context,
    credentialSubject: epcisTransformationCrendentialSubject(
      inputIdentifiers.map((item: any) => item),
      identifiersContext,
      dlrContext.dlrAPIUrl,
      productTransformation,
    ),
    issuer: vcKitContext.issuer,
    type: [...epcisTransformationEvent.type],
    vcKitAPIUrl: vcKitContext.vckitAPIUrl,
    ...restOfVC,
  });

  return epcisVc;
};

/**
 * Upload the verifiable credential to the storage
 * @param filename - filename of the verifiable credential
 * @param vc - verifiable credential to be uploaded
 * @param storageContext - context for the storage to upload the verifiable credential
 * @returns string - url of the uploaded verifiable credential
 */
export const uploadVC = async (filename: string, vc: VerifiableCredential, storageContext: IStorageContext) => {
  const result = await uploadJson({
    filename: filename,
    json: vc,
    bucket: storageContext.bucket,
    storageAPIUrl: storageContext.storageAPIUrl,
  });
  return result;
};

/**
 *  Issue DPP for the given identifiers and return the verifiable credential
 * @param dppContext - context for the vckit to issue vc for dpp
 * @param identifiers - identifiers of the product
 * @param numberOfItems - number of cows
 * @param linkEpcis - link to the epcis event
 * @returns
 */
export const issueDPP = async (
  vcKitContext: IVCKitContext,
  dppContext: ICredential,
  identifiers: string,
  numberOfItems: number,
  linkEpcis: string,
  productTransformation: IProductTransformation,
  data: any,
) => {
  const getOutPutItemsproductTransformation = productTransformation.outputItems;

  const value = incrementQuality(getOutPutItemsproductTransformation, numberOfItems);
  const product = value.find((item) => item.itemID === identifiers);

  if (!product) throw new Error('identifiers not found');

  const restOfVC = { render: dppContext.renderTemplate };

  // add the epcis event link to the traceabilityInfo of the batch

  const result: VerifiableCredential = await issueVC({
    context: dppContext.context,
    issuer: vcKitContext.issuer,
    type: dppContext.type,
    vcKitAPIUrl: vcKitContext.vckitAPIUrl,
    credentialSubject: {
      ...data.data,
      batch: {
        traceabilityInfo: [
          {
            EventReference: linkEpcis,
            EventType: EPCISEventType.Transformation,
          },
        ],
      },
    },
    ...restOfVC,
  });

  return result;
};
