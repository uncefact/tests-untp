import { VerifiableCredential } from '@vckit/core-types';

import { issueVC } from '../vckit.service.js';
import { uploadJson } from '../storage.service.js';
import { IdentificationKeyType, registerLinkResolver } from '../linkResolver.service.js';

import { IService } from '../types/IService.js';
import {
  ILinkResolverContext,
  IProductTransformation,
  IStorageContext,
  ITransFormaionEvent,
  IVCKitContext,
} from './types';
import { generateUUID, incrementQuality } from '../utils/helpers.js';
import { epcisTransformationCrendentialSubject } from '../epcis.service.js';

/**
 * Process transformation event, issue epcis transformation event and dpp for each gtin, then upload to storage and register link resolver for each dpp
 * @param data - data for the transformation event, which nlsids are selected
 * @param context - context for the transformation event, which includes the epcisVckit, gtins, dlr, dppVckit, storage, etc.
 */
export const processTransformationEvent: IService = async (data: any, context: ITransFormaionEvent): Promise<any> => {
  try {
    const epcisVckitContext = context.epcisVckit;
    const gtinContext = context.gtins;
    const dlrContext = context.dlr;
    const productTranformation = context.productTranformation;
    const epcisVc = await issueEpcisTransformationEvent(
      epcisVckitContext,
      gtinContext,
      dlrContext,
      data,
      productTranformation,
    );

    const storageContext = context.storage;
    const transformantionEventLink = await uploadVC(
      `epcis-transformation-event/${generateUUID()}`,
      epcisVc,
      storageContext,
    );

    const dppVckitContext = context.dppVckit;
    await Promise.all(
      gtinContext.map(async (gtin: string) => {
        const qualifierPath = context.dlr.epicsQualifierPath;
        const linkResolverContext = context.dlr;

        const transformationEventLinkResolver = await registerLinkResolver(
          transformantionEventLink,
          IdentificationKeyType[linkResolverContext.identificationKeyType as keyof typeof IdentificationKeyType],
          gtin,
          'EPCIS transformation event VC',
          linkResolverContext.verificationPage,
          linkResolverContext.dlrAPIUrl,
          linkResolverContext.dlrAPIKey,
          qualifierPath,
        );

        const dpp = await issueDPP(
          dppVckitContext,
          gtin,
          data?.length,
          transformationEventLinkResolver,
          productTranformation,
          data,
        );
        const DPPLink = await uploadVC(`${gtin}/${generateUUID()}`, dpp, storageContext);
        await registerLinkResolver(
          DPPLink,
          IdentificationKeyType.gtin,
          gtin,
          linkResolverContext.linkTitle,
          linkResolverContext.verificationPage,
          linkResolverContext.dlrAPIUrl,
          linkResolverContext.dlrAPIKey,
          'Digital Product Passport',
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
 * @param gtinContext - list of gtin of products
 * @param dlrContext - context for the link resolver to register link resolver for the epcis transformation event
 * @param data - data for the transformation event, which nlsids are selected
 * @returns VerifiableCredential
 */
export const issueEpcisTransformationEvent = async (
  vckitContext: IVCKitContext,
  gtinContext: string[],
  dlrContext: ILinkResolverContext,
  data: any,
  productTranformation: IProductTransformation,
) => {
  const restOfVC = { render: vckitContext.renderTemplate };  
  const { nlisids } = data; // TODO: check the name of the field

  const epcisVc: VerifiableCredential = await issueVC({
    context: vckitContext.context,
    credentialSubject: epcisTransformationCrendentialSubject(
      nlisids.map((item: any) => item.value),
      gtinContext,
      dlrContext.dlrAPIUrl,
      productTranformation,
    ),
    issuer: vckitContext.issuer,
    type: [...vckitContext.type],
    vcKitAPIUrl: vckitContext.vckitAPIUrl,
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
 *  Issue DPP for the given gtin and return the verifiable credential
 * @param dppVckitContext - context for the vckit to issue vc for dpp
 * @param gtin - gtin of the product
 * @param numberOfItems - number of cows
 * @param linkEpcis - link to the epcis event
 * @returns
 */
export const issueDPP = async (
  dppVckitContext: IVCKitContext,
  gtin: string,
  numberOfItems: number,
  linkEpcis: string,
  productTranformation: IProductTransformation,
  data: any,
) => {
  const getOutPutItemsProductTranformation = productTranformation.outputItems;

  const value = incrementQuality(getOutPutItemsProductTranformation, numberOfItems);
  const gtinData: { [k: string]: any } = value;

  const product = gtinData[gtin];

  if (!product) throw new Error('GTIN not found');

  const restOfVC = { render: dppVckitContext.renderTemplate };
  const result: VerifiableCredential = await issueVC({
    context: dppVckitContext.context,
    issuer: dppVckitContext.issuer,
    type: dppVckitContext.type,
    vcKitAPIUrl: dppVckitContext.vckitAPIUrl,
    credentialSubject: data.data,
    ...restOfVC,
  });

  return result;
};
