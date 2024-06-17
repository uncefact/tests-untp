import { VerifiableCredential } from '@vckit/core-types';
import _ from 'lodash';

import { issueVC } from '../vckit.service.js';
import { getStorageServiceLink } from '../storage.service.js';
import { LinkType, getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service.js';
import { epcisTransformationCrendentialSubject } from '../epcis.service.js';
import { buildDPPCredentialSubject } from '../dpp.service.js';

import { IService } from '../types/IService.js';
import {
  IConfigDLR,
  ICredential,
  IEntityIssue,
  IProductTransformation,
  ITransformationEvent,
  IVCKitContext,
} from './types';
import { generateUUID, incrementQuality } from '../utils/helpers.js';
import { validateContextTransformationEvent } from './validateContext.js';
import { StorageServiceConfig } from '../types/storage.js';

/**
 * Process transformation event, issue epcis transformation event and dpp for each identifiers, then upload to storage and register link resolver for each dpp
 * @param data - data for the transformation event, which nlsids are selected
 * @param context - context for the transformation event
 */
export const processTransformationEvent: IService = async (data: any, context: ITransformationEvent): Promise<any> => {
  try {
    const validationResult = validateContextTransformationEvent(context);
    if (!validationResult.ok) throw new Error(validationResult.value);

    const epcisTransformationEventContext = context.epcisTransformationEvent;
    const dlrContext = context.dlr;
    const vcKitContext = context.vckit;
    const productTransformation = context.productTransformation;
    const identifierKeyPathsContext = context.identifierKeyPaths;
    if (!inputIdentifiers) throw new Error('Input Identifiers not found');

    const epcisVc = await issueEpcisTransformationEvent(
      vcKitContext,
      epcisTransformationEventContext,
      dlrContext,
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
    if (!detailOfOutputProducts) throw new Error('Output Items not found');

    await Promise.all(
      detailOfOutputProducts.map(async (outputItem: any) => {
        const { identifier, qualifierPath } = getLinkResolverIdentifier(outputItem.productID);

        const transformationEventLinkResolver = await registerLinkResolver(
          transformantionEventLink,
          epcisTransformationEventContext.dlrIdentificationKeyType,
          identifier,
          epcisTransformationEventContext.dlrLinkTitle,
          LinkType.epcisLinkType,
          epcisTransformationEventContext.dlrVerificationPage,
          dlrContext.dlrAPIUrl,
          dlrContext.dlrAPIKey,
          qualifierPath,
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

        await registerLinkResolver(
          DPPLink,
          dppContext.dlrIdentificationKeyType,
          identifier,
          dppContext.dlrLinkTitle,
          LinkType.certificationLinkType,
          dppContext.dlrVerificationPage,
          dlrContext.dlrAPIUrl,
          dlrContext.dlrAPIKey,
          qualifierPath,
        );
      }),
    );

    return epcisVc;
  } catch (error: any) {
    throw new Error(error);
  }
};

/**
 * Issue epcis transformation event and return the verifiable credential
 * @param vckitContext - context for the vckit to issue vc for epcis transformation event
 * @param epcisTransformationEvent - context for the vckit to issue vc for epcis transformation event
 * @param dlrContext - context for the vckit to issue vc for epcis transformation event
 * @param productTransformation - context for the vckit to issue vc for epcis transformation event
 * @param inputIdentifiers - input identifiers for the transformation event
 * @returns VerifiableCredential
 */
export const issueEpcisTransformationEvent = async (
  vcKitContext: IVCKitContext,
  epcisTransformationEvent: IEntityIssue,
  dlrContext: IConfigDLR,
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
      epcisTransformationEvent.dlrIdentificationKeyType,
    ),
    issuer: vcKitContext.issuer,
    type: [...epcisTransformationEvent.type],
    vcKitAPIUrl: vcKitContext.vckitAPIUrl,
    restOfVC,
  });

  return epcisVc;
};

/**
 * Upload the verifiable credential to the storage
 * @param path - filename of the verifiable credential
 * @param vc - verifiable credential to be uploaded
 * @param storageContext - context for the storage to upload the verifiable credential
 * @returns string - url of the uploaded verifiable credential
 */
export const uploadVC = async (path: string, vc: VerifiableCredential, storageContext: StorageServiceConfig) => {
  const result = await getStorageServiceLink(storageContext, vc, path);
  return result;
};

/**
 *  Issue DPP for the given identifiers and return the verifiable credential
 * @param vcKitContext - context for the vckit to issue vc for dpp
 * @param dppContext - context for the vckit to issue vc for dpp
 * @param numberOfItems - number of cows
 * @param linkEpcis - link to the epcis event
 * @param data - data for the transformation event, which nlsids are selected
 * @param outputItem - output item of the transformation event
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
    restOfVC,
  });

  return result;
};
