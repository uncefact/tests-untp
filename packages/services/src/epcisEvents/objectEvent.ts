import { VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { IContext } from './types.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { generateUUID } from '../utils/helpers.js';

import { uploadJson } from '../storage.service.js';
import { issueVC } from '../vckit.service.js';
import { DLREventEnum, registerLinkResolver } from '../linkResolver.service.js';
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

    const vckitContext = context.vckit;
    const dppContext = context.dpp;
    const restOfVC = { render: dppContext?.renderTemplate ?? [] };    
    const vc: VerifiableCredential = await issueVC({
      context: dppContext.context,
      credentialSubject: data.data,
      issuer: vckitContext.issuer,
      type: [...dppContext.type],
      vcKitAPIUrl: vckitContext.vckitAPIUrl,
      restOfVC,
    });

    const identifier = getIdentifierByObjectKeyPaths(data.data, context.identifierKeyPaths) as string;
    if (!identifier) throw new Error('Identifier not found');

    const storageContext = context.storage;

    const vcUrl = await uploadJson({
      filename: `${identifier}/${generateUUID()}`,
      json: vc,
      bucket: storageContext.bucket,
      storageAPIUrl: storageContext.storageAPIUrl,
    });

    const linkResolverContext = context.dlr;
    await registerLinkResolver(
      vcUrl,
      dppContext.dlrIdentificationKeyType,
      identifier,
      dppContext.dlrLinkTitle,
      dppContext.dlrVerificationPage,
      linkResolverContext.dlrAPIUrl,
      linkResolverContext.dlrAPIKey,
      DLREventEnum.object
    );

    return vc;
  } catch (error: any) {
    throw new Error(error.message ?? 'Error processing object event');
  }
};
