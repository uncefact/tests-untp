import { VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { IContext } from './types.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { generateUUID } from '../utils/helpers.js';

import { getStorageServiceLink } from '../storage.service.js';
import { issueVC } from '../vckit.service.js';
import { getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service.js';
import { validateContextObjectEvent } from './validateContext.js';

/**
 * Process object event, issue VC, upload to storage and register link resolver
 * @param data - object event data, e.g. { data: { herd: { NLIS: 'NH020188LEJ00012' } } }
 * @param context - object event context
 * @returns
 */
export const processObjectEvent: IService = async (data: any, context: IContext): Promise<any> => {
  try {
    const validationResult = validateContextObjectEvent(context);
    if (!validationResult.ok) throw new Error(validationResult.value);

    const objectIdentifier = getIdentifierByObjectKeyPaths(data.data, context.identifierKeyPaths);
    if (!objectIdentifier) throw new Error('Identifier not found');

    const { identifier, qualifierPath } = getLinkResolverIdentifier(objectIdentifier);

    const vckitContext = context.vckit;
    const dppContext = context.dpp;
    const restOfVC = { render: dppContext?.renderTemplate ?? [] };    
    const vc: VerifiableCredential = await issueVC({
      context: dppContext.context,
      credentialSubject: {itemList: [{ itemID: `${context.dlr.dlrAPIUrl}/${context.dpp.dlrIdentificationKeyType}/${identifier}${qualifierPath}` }]},
      issuer: vckitContext.issuer,
      type: [...dppContext.type],
      vcKitAPIUrl: vckitContext.vckitAPIUrl,
      restOfVC,
    });

    const storageContext = context.storage;
    const vcUrl = await getStorageServiceLink(storageContext, vc, `${identifier}/${generateUUID()}`);


    const linkResolverContext = context.dlr;
    await registerLinkResolver(
      vcUrl,
      dppContext.dlrIdentificationKeyType,
      identifier,
      dppContext.dlrLinkTitle,
      dppContext.dlrVerificationPage,
      linkResolverContext.dlrAPIUrl,
      linkResolverContext.dlrAPIKey,
      qualifierPath
    );

    return vc;
  } catch (error: any) {
    throw new Error(error.message ?? 'Error processing object event');
  }
};
