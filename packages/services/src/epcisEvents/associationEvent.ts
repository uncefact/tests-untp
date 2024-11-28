import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType } from '../linkResolver.service.js';
import { uploadData } from '../storage.service.js';
import { IService } from '../types/IService.js';
import { generateUUID } from '../utils/helpers.js';
import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { ITraceabilityEvent, ITraceabilityEventContext } from '../types/index.js';
import { validateTraceabilityEventContext } from '../validateContext.js';
import { constructIdentifierData, constructQualifierPath } from '../identifierSchemes/identifierSchemeServices.js';

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

  const aiData = constructIdentifierData(identifierKeyPath, associationEvent.data);
  if (!aiData.primary.ai || !aiData.primary.value) throw new Error('Identifier not found');
  const qualifierPath = constructQualifierPath(aiData.qualifiers);
  const identifier = aiData.primary.value;

  const credentialId = generateUUID();

  const restOfVC: any = {
    id: `urn:uuid:${credentialId}`,
    render: traceabilityEvent.renderTemplate,
  };

  if (traceabilityEvent.validUntil) {
    restOfVC.validUntil = traceabilityEvent.validUntil;
  }

  const associationEventVc: VerifiableCredential = await issueVC({
    credentialSubject: associationEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: traceabilityEvent.context,
    type: traceabilityEvent.type,
    restOfVC,
  });

  const decodedEnvelopedVC = decodeEnvelopedVC(associationEventVc);
  const associationEventVcUrl = await uploadData(storage, associationEventVc, credentialId);

  const associationEventLinkResolver = await registerLinkResolver(
    associationEventVcUrl,
    aiData.primary.ai,
    identifier,
    traceabilityEvent.dlrLinkTitle,
    LinkType.traceability,
    traceabilityEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    qualifierPath,
    LinkType.traceability,
  );

  return { vc: associationEventVc, decodedEnvelopedVC, linkResolver: associationEventLinkResolver };
};
