import { W3CVerifiableCredential } from '@vckit/core-types';
import { IDppContext, IService } from './types/index.js';
import { constructVerifyURL, generateUUID } from './utils/helpers.js';
import { uploadData } from './storage.service.js';
import { decodeEnvelopedVC, issueVC } from './vckit.service.js';
import { validateContextDPP } from './validateContext.js';
import { deleteItemFromLocalStorage } from './features/localStorage.service.js';
import { LinkType, registerLinkResolver } from './linkResolver.service.js';
import { constructIdentifierData, constructQualifierPath } from './identifierSchemes/identifierSchemeServices.js';

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

    const aiData = constructIdentifierData(context.identifierKeyPath, credentialSubject);
    if (!aiData.primary.ai || !aiData.primary.value) throw new Error('Identifier not found');
    const qualifierPath = constructQualifierPath(aiData.qualifiers);
    const identifier = aiData.primary.value;

    const credentialId = generateUUID();
    const vckitContext = context.vckit;
    const dppContext = context.dpp;

    const restOfVC = { id: `urn:uuid:${credentialId}`, render: dppContext?.renderTemplate ?? [] };

    const vc: W3CVerifiableCredential = await issueVC({
      context: dppContext.context,
      credentialSubject,
      issuer: vckitContext.issuer,
      type: [...dppContext.type],
      vcKitAPIUrl: vckitContext.vckitAPIUrl,
      headers: vckitContext.headers,
      restOfVC,
    });

    const decodedEnvelopedVC = decodeEnvelopedVC(vc);

    const storageContext = context.storage;
    const { uri, key, hash } = await uploadData(storageContext, vc, credentialId);
    const verifyURL = constructVerifyURL({ uri, key, hash });

    const linkResolverContext = context.dlr;
    const linkResolver = await registerLinkResolver(
      uri,
      verifyURL,
      aiData.primary.ai,
      identifier,
      dppContext.dlrLinkTitle,
      LinkType.sustainabilityInfo,
      dppContext.dlrVerificationPage,
      linkResolverContext.dlrAPIUrl,
      linkResolverContext.dlrAPIKey,
      linkResolverContext.namespace,
      qualifierPath,
      LinkType.sustainabilityInfo,
    );

    if (context.localStorageParams && context.localStorageParams.storageKey) {
      deleteItemFromLocalStorage(context.localStorageParams);
    }

    return { vc, decodedEnvelopedVC, linkResolver };
  } catch (error: any) {
    throw new Error(error.message ?? 'Error processing DPP');
  }
};
