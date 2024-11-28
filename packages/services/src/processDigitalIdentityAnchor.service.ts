import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType } from './linkResolver.service.js';
import { uploadData } from './storage.service.js';
import { IService } from './types/IService.js';
import { constructIdentifierString, constructVerifyURL, generateUUID } from './utils/helpers.js';
import { decodeEnvelopedVC, issueVC } from './vckit.service.js';
import { ITraceabilityEvent, IDigitalIdentityAnchorContext } from './types/index.js';
import { validateDigitalIdentityAnchorContext } from './validateContext.js';
import { constructIdentifierData, constructQualifierPath } from './identifierSchemes/identifierSchemeServices.js';

/**
 * Processes a digital identity anchor by issuing a verifiable credential, storing it in a storage service and registering a link resolver.
 * @param digitalIdentityAnchorData The digital identity anchor to process, containing the digital identity anchor data
 * @param context The context to use for processing the digital identity anchor
 * @returns The result of processing the digital identity anchor
 */
export const processDigitalIdentityAnchor: IService = async (
  digitalIdentityAnchorData: ITraceabilityEvent,
  context: IDigitalIdentityAnchorContext,
): Promise<any> => {
  const validationResult = validateDigitalIdentityAnchorContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!digitalIdentityAnchorData.data) {
    throw new Error('digitalIdentityAnchor data not found');
  }

  const { vckit, digitalIdentityAnchor, dlr, storage, identifierKeyPath } = context;

  const aiData = constructIdentifierData(identifierKeyPath, digitalIdentityAnchorData.data);
  if (!aiData.primary.ai || !aiData.primary.value) throw new Error('Identifier not found');
  const qualifierPath = constructQualifierPath(aiData.qualifiers);
  const identifier = aiData.primary.value;

  const credentialId = generateUUID();

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: digitalIdentityAnchorData.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: digitalIdentityAnchor.context,
    type: digitalIdentityAnchor.type,
    restOfVC: {
      id: `urn:uuid:${credentialId}`,
      render: digitalIdentityAnchor.renderTemplate,
    },
  });

  const decodedEnvelopedVC = decodeEnvelopedVC(vc);

  const { uri, key, hash } = await uploadData(storage, vc, credentialId);
  const verifyURL = constructVerifyURL({ uri, key, hash });

  const linkResolver = await registerLinkResolver(
    uri,
    verifyURL,
    aiData.primary.ai,
    identifier,
    digitalIdentityAnchor.dlrLinkTitle,
    LinkType.registryEntry,
    digitalIdentityAnchor.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    qualifierPath,
    LinkType.registryEntry,
  );

  return { vc, decodedEnvelopedVC, linkResolver };
};
