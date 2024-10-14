import { W3CVerifiableCredential } from '@vckit/core-types';
import { IService, IDppContext } from './types/index.js';
import { constructIdentifierString, generateUUID } from './utils/helpers.js';

import { getStorageServiceLink } from './storage.service.js';
import { issueVC } from './vckit.service.js';
import { LinkType, getLinkResolverIdentifier, registerLinkResolver } from './linkResolver.service.js';
import { validateContextDPP } from './validateContext.js';
import { deleteItemFromLocalStorage } from './features/localStorage.service.js';

/**
 * Process DPP, issue VC, upload to storage and register link resolver
 * @param data - DPP data, e.g. { data: { product: {...} } }
 * @param context - DPP context
 * @returns
 */
export const processDPP: IService = async (data: any, context: IDppContext): Promise<any> => {
  try {
    const credentialSubject = data.data;
    const validationResult = validateContextDPP(context);
    if (!validationResult.ok) throw new Error(validationResult.value);

    const objectIdentifier = constructIdentifierString(credentialSubject, context.identifierKeyPath);
    if (!objectIdentifier) throw new Error('Identifier not found');

    const { identifier, qualifierPath } = getLinkResolverIdentifier(objectIdentifier);

    const vckitContext = context.vckit;
    const dppContext = context.dpp;
    const restOfVC = { render: dppContext?.renderTemplate ?? [] };
    const vc: W3CVerifiableCredential = await issueVC({
      context: dppContext.context,
      credentialSubject,
      issuer: vckitContext.issuer,
      type: [...dppContext.type],
      vcKitAPIUrl: vckitContext.vckitAPIUrl,
      restOfVC,
    });

    const storageContext = context.storage;
    const vcUrl = await getStorageServiceLink(storageContext, vc, `${identifier}/${qualifierPath}`);

    const linkResolverContext = context.dlr;
    const linkResolver = await registerLinkResolver(
      vcUrl,
      dppContext.dlrIdentificationKeyType,
      identifier,
      dppContext.dlrLinkTitle,
      LinkType.certificationLinkType,
      dppContext.dlrVerificationPage,
      linkResolverContext.dlrAPIUrl,
      linkResolverContext.dlrAPIKey,
      linkResolverContext.namespace,
      qualifierPath,
      LinkType.certificationLinkType,
    );

    if (context.localStorageParams && context.localStorageParams.storageKey) {
      deleteItemFromLocalStorage(context.localStorageParams);
    }

    return { vc, linkResolver };
  } catch (error: any) {
    throw new Error(error.message ?? 'Error processing DPP');
  }
};
