import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType, getLinkResolverIdentifier } from './linkResolver.service.js';
import { uploadData } from './storage.service.js';
import { IService } from './types/IService.js';
import { constructIdentifierString, generateUUID } from './utils/helpers.js';
import { issueVC } from './vckit.service.js';
import { ITraceabilityEvent, IDigitalIdentityAnchorContext } from './types/index.js';
import { validateDigitalIdentityAnchorContext } from './validateContext.js';

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

  const identifierString = constructIdentifierString(digitalIdentityAnchorData.data, identifierKeyPath);
  if (!identifierString) {
    throw new Error('Identifier not found');
  }

  const { identifier, qualifierPath } = getLinkResolverIdentifier(identifierString);

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: digitalIdentityAnchorData.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: digitalIdentityAnchor.context,
    type: digitalIdentityAnchor.type,
    restOfVC: {
      render: digitalIdentityAnchor.renderTemplate,
    },
  });

  const vcUrl = await uploadData(storage, vc, generateUUID());

  const linkResolver = await registerLinkResolver(
    vcUrl,
    digitalIdentityAnchor.dlrIdentificationKeyType,
    identifier,
    digitalIdentityAnchor.dlrLinkTitle,
    LinkType.certificationLinkType,
    digitalIdentityAnchor.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    qualifierPath,
    LinkType.certificationLinkType,
  );

  return { vc, linkResolver };
};
