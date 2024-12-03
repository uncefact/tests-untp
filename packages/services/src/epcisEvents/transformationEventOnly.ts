import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType } from '../linkResolver.service.js';
import { uploadData } from '../storage.service.js';
import { IService } from '../types/IService.js';
import { constructIdentifierString, constructVerifyURL, generateUUID } from '../utils/helpers.js';
import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { ITraceabilityEvent, ITraceabilityEventContext } from '../types/index.js';
import { validateTraceabilityEventContext } from '../validateContext.js';
import { constructIdentifierData, constructQualifierPath } from '../identifierSchemes/identifierSchemeServices.js';

/**
 * Processes an transformation event by issuing a verifiable credential, storing it in a storage service and registering a link resolver.
 * @param transformationEvent The transformation event to process, containing the transformation event data
 * @param context The context to use for processing the transformation event
 * @returns The result of processing the transformation event
 */
export const processTransformationEventOnly: IService = async (
  transformationEvent: ITraceabilityEvent,
  context: ITraceabilityEventContext,
): Promise<any> => {
  const validationResult = validateTraceabilityEventContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!transformationEvent.data) {
    throw new Error('Transformation event data not found');
  }

  const { vckit, traceabilityEvent, dlr, storage, identifierKeyPath } = context;

  const aiData = constructIdentifierData(identifierKeyPath, transformationEvent.data);
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

  const transformationEventVc: VerifiableCredential = await issueVC({
    credentialSubject: transformationEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: traceabilityEvent.context,
    type: traceabilityEvent.type,
    restOfVC,
  });

  const decodedEnvelopedVC = decodeEnvelopedVC(transformationEventVc);
  const { uri, key, hash } = await uploadData(storage, transformationEventVc, credentialId);
  const verifyURL = constructVerifyURL({ uri, key, hash });

  const transformationEventLinkResolver = await registerLinkResolver(
    uri,
    verifyURL,
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

  return { vc: transformationEventVc, decodedEnvelopedVC, linkResolver: transformationEventLinkResolver };
};
