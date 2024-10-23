import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType, getLinkResolverIdentifier } from './linkResolver.service.js';
import { uploadData } from './storage.service.js';
import { IService } from './types/IService.js';
import { constructIdentifierString, generateUUID } from './utils/helpers.js';
import { issueVC } from './vckit.service.js';
import { ITraceabilityEvent, IDigitalConformityCredentialContext } from './types/index.js';
import { validateDigitalConformityCredentialContext } from './validateContext.js';

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

  const identifierString = constructIdentifierString(digitalConformityCredentialData.data, identifierKeyPath);
  if (!identifierString) {
    throw new Error('Identifier not found');
  }

  const { identifier, qualifierPath } = getLinkResolverIdentifier(identifierString);

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: digitalConformityCredentialData.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: digitalConformityCredential.context,
    type: digitalConformityCredential.type,
    restOfVC: {
      render: digitalConformityCredential.renderTemplate,
    },
  });

  const vcUrl = await uploadData(storage, vc, generateUUID());

  const linkResolver = await registerLinkResolver(
    vcUrl,
    digitalConformityCredential.dlrIdentificationKeyType,
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

  return { vc, linkResolver };
};
