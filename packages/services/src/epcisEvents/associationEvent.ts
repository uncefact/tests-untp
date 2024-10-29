import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType, getLinkResolverIdentifier } from '../linkResolver.service.js';
import { uploadData } from '../storage.service.js';
import { IService } from '../types/IService.js';
import { constructIdentifierString, generateUUID } from '../utils/helpers.js';
import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { ITraceabilityEvent, IAssociationEventContext } from '../types/index.js';
import { validateAssociationEventContext } from '../validateContext.js';

/**
 * Processes an association event by issuing a verifiable credential, storing it in a storage service and registering a link resolver.
 * @param associationEvent The association event to process, containing the association event data
 * @param context The context to use for processing the association event
 * @returns The result of processing the association event
 */
export const processAssociationEvent: IService = async (
  associationEvent: ITraceabilityEvent,
  context: IAssociationEventContext,
): Promise<any> => {
  const validationResult = validateAssociationEventContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!associationEvent.data) {
    throw new Error('Association event data not found');
  }

  const { vckit, epcisAssociationEvent, dlr, storage, identifierKeyPath } = context;

  const associationIdentifier = constructIdentifierString(associationEvent.data, identifierKeyPath);
  if (!associationIdentifier) {
    throw new Error('Identifier not found');
  }

  const { identifier: associationEventIdentifier, qualifierPath: associationEventQualifierPath } =
    getLinkResolverIdentifier(associationIdentifier);

  const associationEventVc: VerifiableCredential = await issueVC({
    credentialSubject: associationEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: epcisAssociationEvent.context,
    type: epcisAssociationEvent.type,
    restOfVC: {
      render: epcisAssociationEvent.renderTemplate,
    },
  });

  const decodedEnvelopedVC = decodeEnvelopedVC(associationEventVc);
  const associationEventVcUrl = await uploadData(storage, associationEventVc, generateUUID());

  const associationEventLinkResolver = await registerLinkResolver(
    associationEventVcUrl,
    epcisAssociationEvent.dlrIdentificationKeyType,
    associationEventIdentifier,
    epcisAssociationEvent.dlrLinkTitle,
    LinkType.epcisLinkType,
    epcisAssociationEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    associationEventQualifierPath,
    LinkType.epcisLinkType,
  );

  return { vc: associationEventVc, decodedEnvelopedVC, linkResolver: associationEventLinkResolver };
};
