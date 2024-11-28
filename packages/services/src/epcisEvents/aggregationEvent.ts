import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { uploadData } from '../storage.service.js';
import { LinkType, registerLinkResolver } from '../linkResolver.service.js';
import { IService } from '../types/IService.js';
import { ITraceabilityEvent, ITraceabilityEventContext } from '../types';
import { constructIdentifierString, constructVerifyURL, generateUUID } from '../utils/helpers.js';
import { validateTraceabilityEventContext } from '../validateContext.js';
import { constructIdentifierData, constructQualifierPath } from '../identifierSchemes/identifierSchemeServices.js';

export const processAggregationEvent: IService = async (
  aggregationEvent: ITraceabilityEvent,
  context: ITraceabilityEventContext,
): Promise<any> => {
  const validationResult = validateTraceabilityEventContext(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { vckit, traceabilityEvent, dlr, storage, identifierKeyPath } = context;

  const aiData = constructIdentifierData(identifierKeyPath, aggregationEvent.data);
  if (!aiData.primary.ai || !aiData.primary.value) throw new Error('Identifier not found');
  const qualifierPath = constructQualifierPath(aiData.qualifiers);
  const identifier = aiData.primary.value;

  const credentialId = generateUUID();

  const aggregationVC = await issueVC({
    credentialSubject: aggregationEvent.data,
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

  const decodedEnvelopedVC = decodeEnvelopedVC(aggregationVC);
  const { uri, key, hash } = await uploadData(storage, aggregationVC, credentialId);
  const verifyURL = constructVerifyURL({ uri, key, hash });

  const aggregationLinkResolver = await registerLinkResolver(
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

  return { vc: aggregationVC, decodedEnvelopedVC, linkResolver: aggregationLinkResolver };
};
