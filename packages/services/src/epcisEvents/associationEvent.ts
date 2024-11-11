import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType, getLinkResolverIdentifier } from '../linkResolver.service.js';
import { uploadData } from '../storage.service.js';
import { IService } from '../types/IService.js';
import { constructIdentifierString, constructVerifyURL, generateUUID } from '../utils/helpers.js';
import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { ITraceabilityEvent, ITraceabilityEventContext } from '../types/index.js';
import { validateTraceabilityEventContext } from '../validateContext.js';

/**
 * Processes an association event by issuing a verifiable credential, storing it in a storage service and registering a link resolver.
 * @param associationEvent The association event to process, containing the association event data
 * @param context The context to use for processing the association event
 * @returns The result of processing the association event
 */
export const processAssociationEvent: IService = async (
  associationEvent: ITraceabilityEvent,
  context: ITraceabilityEventContext,
): Promise<any> => {
  const validationResult = validateTraceabilityEventContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!associationEvent.data) {
    throw new Error('Association event data not found');
  }

  const { vckit, traceabilityEvent, dlr, storage, identifierKeyPath } = context;

  const associationIdentifier = constructIdentifierString(associationEvent.data, identifierKeyPath);
  if (!associationIdentifier) {
    throw new Error('Identifier not found');
  }

  const { identifier: associationEventIdentifier, qualifierPath: associationEventQualifierPath } =
    getLinkResolverIdentifier(associationIdentifier);

  const credentialId = generateUUID();

  const associationEventVc: VerifiableCredential = await issueVC({
    credentialSubject: associationEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: traceabilityEvent.context,
    type: traceabilityEvent.type,
    restOfVC: {
      id: `urn:uuid:${credentialId}`,
      render: traceabilityEvent.renderTemplate,
    },
  });

  const decodedEnvelopedVC = decodeEnvelopedVC(associationEventVc);
  const { uri, key, hash } = await uploadData(storage, associationEventVc, credentialId);
  const verifyURL = constructVerifyURL({ uri, key, hash });

  const associationEventLinkResolver = await registerLinkResolver(
    uri,
    verifyURL,
    traceabilityEvent.dlrIdentificationKeyType,
    associationEventIdentifier,
    traceabilityEvent.dlrLinkTitle,
    LinkType.epcisLinkType,
    traceabilityEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    associationEventQualifierPath,
    LinkType.epcisLinkType,
  );

  return { vc: associationEventVc, decodedEnvelopedVC, linkResolver: associationEventLinkResolver };
};
