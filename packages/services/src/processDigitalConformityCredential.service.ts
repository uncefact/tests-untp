import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType } from './linkResolver.service.js';
import { uploadData } from './storage.service.js';
import { IService } from './types/IService.js';
import { constructIdentifierString, constructVerifyURL, generateUUID } from './utils/helpers.js';
import { decodeEnvelopedVC, issueVC } from './vckit.service.js';
import { ITraceabilityEvent, IDigitalConformityCredentialContext } from './types/index.js';
import { validateDigitalConformityCredentialContext } from './validateContext.js';
import { constructIdentifierData, constructQualifierPath } from './identifierSchemes/identifierSchemeServices.js';

/**
 * Processes a digital conformity credential by issuing a verifiable credential, storing it in a storage service and registering a link resolver.
 * @param digitalConformityCredentialData The digital conformity credential to process, containing the digital conformity credential data
 * @param context The context to use for processing the digital conformity credential
 * @returns The result of processing the digital conformity credential
 */
export const processDigitalConformityCredential: IService = async (
  digitalConformityCredentialData: ITraceabilityEvent,
  context: IDigitalConformityCredentialContext,
): Promise<any> => {
  const validationResult = validateDigitalConformityCredentialContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!digitalConformityCredentialData.data) {
    throw new Error('digitalConformityCredential data not found');
  }

  const { vckit, digitalConformityCredential, dlr, storage, identifierKeyPath } = context;

  const aiData = constructIdentifierData(identifierKeyPath, digitalConformityCredentialData.data);
  if (!aiData.primary.ai || !aiData.primary.value) throw new Error('Identifier not found');
  const qualifierPath = constructQualifierPath(aiData.qualifiers);
  const identifier = aiData.primary.value;

  const credentialId = generateUUID();

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: digitalConformityCredentialData.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: digitalConformityCredential.context,
    type: digitalConformityCredential.type,
    restOfVC: {
      id: `urn:uuid:${credentialId}`,
      render: digitalConformityCredential.renderTemplate,
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
    digitalConformityCredential.dlrLinkTitle,
    LinkType.certificationLinkType,
    digitalConformityCredential.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    qualifierPath,
    LinkType.certificationLinkType,
  );

  return { vc, decodedEnvelopedVC, linkResolver };
};
