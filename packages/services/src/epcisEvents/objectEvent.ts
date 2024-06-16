import { VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { IContext } from './types.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { generateUUID } from '../utils/helpers.js';

import { getStorageServiceLink } from '../storage.service.js';
import { issueVC } from '../vckit.service.js';
import { LinkType, getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service.js';
import { validateContextObjectEvent } from './validateContext.js';

/**
 * Process object event, issue VC, upload to storage and register link resolver
 * @param data - object event data, e.g. { data: { herd: { NLIS: 'NH020188LEJ00012' } } }
 * @param context - object event context
 * @returns
 */
export const processObjectEvent: IService = async (data: any, context: IContext): Promise<any> => {
  try {
    const credentialSubject = data.data;
    const validationResult = validateContextObjectEvent(context);
    if (!validationResult.ok) throw new Error(validationResult.value);

    const objectIdentifier = getIdentifierByObjectKeyPaths(credentialSubject, context.identifierKeyPaths);
    if (!objectIdentifier) throw new Error('Identifier not found');

    const { identifier, qualifierPath } = getLinkResolverIdentifier(objectIdentifier);

    const vckitContext = context.vckit;
    const dppContext = context.dpp;
    const restOfVC = { render: dppContext?.renderTemplate ?? [] };
    const vc: VerifiableCredential = await issueVC({
      context: dppContext.context,
      credentialSubject,
      issuer: vckitContext.issuer,
      type: [...dppContext.type],
      vcKitAPIUrl: vckitContext.vckitAPIUrl,
      restOfVC,
    });

    const storageContext = context.storage;
    const vcUrl = await getStorageServiceLink(storageContext, vc, `${identifier}/${generateUUID()}`);

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
      qualifierPath,
      LinkType.certificationLinkType,
    );

    return { vc, linkResolver };
  } catch (error: any) {
    throw new Error(error.message ?? 'Error processing object event');
  }
};
