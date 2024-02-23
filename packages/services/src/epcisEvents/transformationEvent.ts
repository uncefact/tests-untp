import { VerifiableCredential } from '@vckit/core-types';
import _ from 'lodash';

import { issueVC } from '../vckit.service.js';
import { uploadJson } from '../storage.service.js';
import { registerLinkResolver } from '../linkResolver.service.js';
import { epcisTransformationCrendentialSubject } from '../epcis.service.js';
import { buildDPPCredentialSubject } from '../dpp.service.js';

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

/**
 * Process transformation event, issue epcis transformation event and dpp for each identifiers, then upload to storage and register link resolver for each dpp
 * @param data - data for the transformation event, which nlsids are selected
 * @param context - context for the transformation event, which includes the epcisTransformationEvent, identifiers, dlr, dpp, storage, etc.
 */
export const processTransformationEvent: IService = async (data: any, context: ITransformationEvent): Promise<any> => {
  try {
    const epcisTransformationEventContext = context.epcisTransformationEvent;
    const dlrContext = context.dlr;
    const vcKitContext = context.vckit;
    const productTransformation = context.productTransformation;
    const identifierKeyPathsContext = context.identifierKeyPaths;
    const inputIdentifiers = getIdentifierByObjectKeyPaths(data.data, identifierKeyPathsContext) as string[];
    if (!inputIdentifiers) throw new Error('Input Identifiers not found');

    const epcisVc = await issueEpcisTransformationEvent(
      vcKitContext,
      epcisTransformationEventContext,
      dlrContext,
      data,
      productTransformation,
      inputIdentifiers,
    );

    const storageContext = context.storage;
    const transformantionEventLink = await uploadVC(
      `epcis-transformation-event/${generateUUID()}`,
      epcisVc,
      storageContext,
    );

    const dppContext = context.dpp;
    const detailOfOutputProducts = productTransformation.outputItems;

    await Promise.all(
      detailOfOutputProducts.map(async (outputItem: any) => {
        const epcisTransformationEventQualifierPath = epcisTransformationEventContext?.dlrQualifierPath;
        const linkResolverContext = context.dlr;

        const transformationEventLinkResolver = await registerLinkResolver(
          transformantionEventLink,
          epcisTransformationEventContext.dlrIdentificationKeyType,
          outputItem.productID,
          epcisTransformationEventContext.dlrLinkTitle,
          epcisTransformationEventContext.dlrVerificationPage,
          linkResolverContext.dlrAPIUrl,
          linkResolverContext.dlrAPIKey,
          epcisTransformationEventQualifierPath,
        );

        const dpp = await issueDPP(
          vcKitContext,
          dppContext,
          inputIdentifiers?.length,
          transformationEventLinkResolver,
          data,
          outputItem,
        );
        const DPPLink = await uploadVC(`${outputItem.productID as string}/${generateUUID()}`, dpp, storageContext);

        const dppQualifierPath = dppContext?.dlrQualifierPath;
        await registerLinkResolver(
          DPPLink,
          dppContext.dlrIdentificationKeyType,
          outputItem.productID,
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
  dlrContext: IConfigDLR,
  data: any,
  productTransformation: IProductTransformation,
  inputIdentifiers: string[],
) => {
  const restOfVC = { render: epcisTransformationEvent.renderTemplate };

  const epcisVc: VerifiableCredential = await issueVC({
    context: epcisTransformationEvent.context,
    credentialSubject: epcisTransformationCrendentialSubject(
      inputIdentifiers.map((item: any) => item),

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
  numberOfItems: number,
  linkEpcis: string,
  data: any,
  outputItem: any,
) => {
  const restOfVC = { render: dppContext.renderTemplate };

  const mappingProductQuality = incrementQuality(outputItem, numberOfItems);
  const mergeProductItem = _.merge({}, mappingProductQuality, data.data);

  const credentialSubject = buildDPPCredentialSubject({ productItem: mergeProductItem, linkEpcis });
  const result: VerifiableCredential = await issueVC({
    context: dppContext.context,
    issuer: vcKitContext.issuer,
    type: dppContext.type,
    vcKitAPIUrl: vcKitContext.vckitAPIUrl,
    credentialSubject,
    ...restOfVC,
  });

  return result;
};
