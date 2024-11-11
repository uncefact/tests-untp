import { VerifiableCredential } from '@vckit/core-types';
import _ from 'lodash';

import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { uploadData } from '../storage.service.js';
import {
  IdentificationKeyType,
  LinkType,
  getLinkResolverIdentifier,
  registerLinkResolver,
} from '../linkResolver.service.js';

import { IService } from '../types/IService.js';
import { IConfigDLR, ICredential, IEntityIssue, ITransformationEventContext, IVCKitContext } from '../types';
import {
  IConstructObjectParameters,
  allowedIndexKeys,
  constructObject,
  constructVerifyURL,
  generateCurrentDatetime,
  generateUUID,
  randomIntegerString,
} from '../utils/helpers.js';
import { generateIdWithBatchLot, generateLinkResolver } from './helpers.js';
import { validateContextTransformationEvent } from '../validateContext.js';
import { StorageServiceConfig } from '../types/storage.js';
import JSONPointer from 'jsonpointer';

/**
 * Process transformation event, issue epcis transformation event and dpp for each identifiers, then upload to storage and register link resolver for each dpp
 * @param data - data for the transformation event
 * @param context - context for the transformation event
 */
export const processTransformationEvent: IService = async (
  data: any,
  context: ITransformationEventContext,
): Promise<any> => {
  try {
    const validationResult = validateContextTransformationEvent(context);
    if (!validationResult.ok) throw new Error(validationResult.value);

    const epcisTransformationEventContext = context.epcisTransformationEvent;
    const dlrContext = context.dlr;
    const vcKitContext = context.vckit;
    const transformationEventCredential = context.transformationEventCredential;

    const transformationEventCredentialId = generateUUID();

    const epcisVc = await issueEpcisTransformationEvent(
      vcKitContext,
      epcisTransformationEventContext,
      dlrContext,
      transformationEventCredential,
      transformationEventCredentialId,
      data,
    );

    const decodedEnvelopedVC = decodeEnvelopedVC(epcisVc);
    const storageContext = context.storage;
    const uploadedTransformationEvent = await uploadVC(transformationEventCredentialId, epcisVc, storageContext);
    const transformationEventVerifyURL = constructVerifyURL(uploadedTransformationEvent);

    const dppContext = context.dpp;

    const dppCredentials = context.dppCredentials;
    if (!dppCredentials) throw new Error('Output Items not found');

    const identifierPath = context.identifierKeyPath;
    const pathIndex = identifierPath.split('/').findIndex((key) => allowedIndexKeys.includes(key));
    await Promise.all(
      dppCredentials.map(async (dppCredential, index) => {
        const headPath = identifierPath.split('/').slice(0, pathIndex).join('/');
        const tailPath = identifierPath
          .split('/')
          .slice(pathIndex + 1)
          .join('/');

        const productID = JSONPointer.get(epcisVc, `${headPath}/${index}/${tailPath}`);
        const { identifier: transformationEventIdentifier, qualifierPath: transformationEventQualifierPath } =
          getLinkResolverIdentifier(`${productID as string}21${randomIntegerString(9)}`);

        const transformationEventLinkResolver = await registerLinkResolver(
          uploadedTransformationEvent.uri,
          transformationEventVerifyURL,
          epcisTransformationEventContext.dlrIdentificationKeyType,
          transformationEventIdentifier,
          epcisTransformationEventContext.dlrLinkTitle,
          LinkType.epcisLinkType,
          epcisTransformationEventContext.dlrVerificationPage,
          dlrContext.dlrAPIUrl,
          dlrContext.dlrAPIKey,
          dlrContext.namespace,
          transformationEventQualifierPath,
          LinkType.epcisLinkType,
        );

        const transformationEventData = {
          vc: epcisVc,
          linkResolver: transformationEventLinkResolver,
        };

        const dppId = generateUUID();

        const dpp = await issueDPP(vcKitContext, dppContext, dppCredential, dppId, transformationEventData);
        const uploadedDPP = await uploadVC(dppId, dpp, storageContext);
        const dppVerifyURL = constructVerifyURL(uploadedDPP);
        const { identifier, qualifierPath } = getLinkResolverIdentifier(productID);

        await registerLinkResolver(
          uploadedDPP.uri,
          dppVerifyURL,
          dppContext.dlrIdentificationKeyType,
          identifier,
          dppContext.dlrLinkTitle,
          LinkType.certificationLinkType,
          dppContext.dlrVerificationPage,
          dlrContext.dlrAPIUrl,
          dlrContext.dlrAPIKey,
          dlrContext.namespace,
          qualifierPath,
        );
      }),
    );

    return { vc: epcisVc, decodedEnvelopedVC, linkResolver: transformationEventVerifyURL };
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
 * @param transformationEventCredentialId - id for the transformation event credential
 * @param inputIdentifiers - input identifiers for the transformation event
 * @returns VerifiableCredential
 */
export const issueEpcisTransformationEvent = async (
  vcKitContext: IVCKitContext,
  epcisTransformationEvent: IEntityIssue,
  dlrContext: IConfigDLR,
  transformationEventCredential: any,
  transformationEventCredentialId: string,
  data: any,
) => {
  const restOfVC = {
    id: `urn:uuid:${transformationEventCredentialId}`,
    render: epcisTransformationEvent.renderTemplate,
  };
  const values = Object.values(data);

  const credentialSubject: any = values.reduce((acc, item, index) => {
    return constructObject(acc, item, transformationEventCredential, index, {
      handlers: {
        generateLinkResolver: generateLinkResolver(
          dlrContext.dlrAPIUrl,
          dlrContext.namespace,
          IdentificationKeyType.gtin,
          `linkType=${dlrContext.namespace}:${LinkType.certificationLinkType}`,
        ),
        generateIdWithBatchLot,
        generateCurrentDatetime,
        generateUUID,
      },
    });
  }, {});

  const epcisVc: VerifiableCredential = await issueVC({
    context: epcisTransformationEvent.context,
    credentialSubject,
    issuer: vcKitContext.issuer,
    type: [...epcisTransformationEvent.type],
    vcKitAPIUrl: vcKitContext.vckitAPIUrl,
    headers: vcKitContext.headers,
    restOfVC,
  });

  return epcisVc;
};

/**
 * Upload the verifiable credential to the storage
 * @param id - id of the verifiable credential
 * @param vc - verifiable credential to be uploaded
 * @param storageContext - context for the storage to upload the verifiable credential
 * @returns string - url of the uploaded verifiable credential
 */
export const uploadVC = async (id: string, vc: VerifiableCredential, storageContext: StorageServiceConfig) => {
  const result = await uploadData(storageContext, vc, id);
  return result;
};

/**
 *  Issue DPP for the given identifiers and return the verifiable credential
 * @param vcKitContext - context for the vckit to issue vc for dpp
 * @param dppContext - context for the vckit to issue vc for dpp
 * @param numberOfItems - number of cows
 * @param linkEpcis - link to the epcis event
 * @param data - data for the transformation event, which nlsids are selected
 * @param dppId - id for the dpp
 * @param outputItem - output item of the transformation event
 * @returns
 */
export const issueDPP = async (
  vcKitContext: IVCKitContext,
  dppContext: ICredential,
  dppCredential: IConstructObjectParameters,
  dppId: string,
  transformationEventData: { vc: VerifiableCredential; linkResolver: string },
) => {
  const restOfVC = { id: `urn:uuid:${dppId}`, render: dppContext.renderTemplate };

  const dppCredentialSubject = constructObject({}, transformationEventData, dppCredential);
  const result: VerifiableCredential = await issueVC({
    context: dppContext.context,
    issuer: vcKitContext.issuer,
    type: dppContext.type,
    vcKitAPIUrl: vcKitContext.vckitAPIUrl,
    headers: vcKitContext.headers,
    credentialSubject: dppCredentialSubject,
    restOfVC,
  });

  return result;
};
