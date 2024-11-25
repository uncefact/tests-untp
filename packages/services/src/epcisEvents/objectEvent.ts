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
 * Processes an object event by issuing a verifiable credential, storing it in a storage service and registering a link resolver.
 * @param objectEvent The object event to process, containing the object event data
 * @param context The context to use for processing the object event
 * @returns The result of processing the object event
 */
export const processObjectEvent: IService = async (
  objectEvent: ITraceabilityEvent,
  context: ITraceabilityEventContext,
): Promise<any> => {
  const validationResult = validateTraceabilityEventContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!objectEvent.data) {
    throw new Error('Object event data not found');
  }

  const { vckit, traceabilityEvent, dlr, storage, identifierKeyPath } = context;

  const aiData = constructIdentifierData(identifierKeyPath, objectEvent.data);
  if (!aiData.primary.ai || !aiData.primary.value) throw new Error('Identifier not found');
  const qualifierPath = constructQualifierPath(aiData.qualifiers);
  const identifier = aiData.primary.value;

  const credentialId = generateUUID();

  const objectEventVc: VerifiableCredential = await issueVC({
    credentialSubject: objectEvent.data,
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

  const decodedEnvelopedVC = decodeEnvelopedVC(objectEventVc);
  const objectEventVcUrl = await uploadData(storage, objectEventVc, credentialId);

  const objectEventLinkResolver = await registerLinkResolver(
    objectEventVcUrl,
    aiData.primary.ai,
    identifier,
    traceabilityEvent.dlrLinkTitle,
    LinkType.epcisLinkType,
    traceabilityEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    qualifierPath,
    LinkType.epcisLinkType,
  );

  return { vc: objectEventVc, decodedEnvelopedVC, linkResolver: objectEventLinkResolver };
};
