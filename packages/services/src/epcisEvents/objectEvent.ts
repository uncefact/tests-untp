import { VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { IContext } from './types.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { generateUUID } from '../utils/helpers.js';

import { uploadJson } from '../storage.service.js';
import { issueVC } from '../vckit.service.js';
import { registerLinkResolver } from '../linkResolver.service.js';

export const processObjectEvent: IService = async (data: any, context: IContext): Promise<any> => {
  try {
    const vckitContext = context.vckit;
    const dppContext = context.dpp;
    const restOfVC = { render: dppContext.renderTemplate };
    const vc: VerifiableCredential = await issueVC({
      context: dppContext.context,
      credentialSubject: data.data,
      issuer: vckitContext.issuer,
      type: [...dppContext.type],
      vcKitAPIUrl: vckitContext.vckitAPIUrl,
      ...restOfVC,
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
    );

    return vc;
  } catch (error: any) {
    throw new Error(error);
  }
};
