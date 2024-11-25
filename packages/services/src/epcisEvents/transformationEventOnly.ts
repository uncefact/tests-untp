import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType, getLinkResolverIdentifier } from '../linkResolver.service.js';
import { uploadData } from '../storage.service.js';
import { IService } from '../types/IService.js';
import { constructIdentifierString, generateUUID } from '../utils/helpers.js';
import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { ITraceabilityEvent, ITraceabilityEventContext } from '../types/index.js';
import { validateTraceabilityEventContext } from '../validateContext.js';

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

  const transformationIdentifier = constructIdentifierString(transformationEvent.data, identifierKeyPath);
  if (!transformationIdentifier) {
    throw new Error('Identifier not found');
  }

  const { identifier: transformationEventIdentifier, qualifierPath: transformationEventQualifierPath } =
    getLinkResolverIdentifier(transformationIdentifier);

  const credentialId = generateUUID();

  const transformationEventVc: VerifiableCredential = await issueVC({
    credentialSubject: transformationEvent.data,
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

  const decodedEnvelopedVC = decodeEnvelopedVC(transformationEventVc);
  const transformationEventVcUrl = await uploadData(storage, transformationEventVc, credentialId);

  const transformationEventLinkResolver = await registerLinkResolver(
    transformationEventVcUrl,
    traceabilityEvent.dlrIdentificationKeyType,
    transformationEventIdentifier,
    traceabilityEvent.dlrLinkTitle,
    LinkType.traceability,
    traceabilityEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    transformationEventQualifierPath,
    LinkType.traceability,
  );

  return { vc: transformationEventVc, decodedEnvelopedVC, linkResolver: transformationEventLinkResolver };
};
