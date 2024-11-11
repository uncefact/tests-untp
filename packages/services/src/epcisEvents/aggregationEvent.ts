import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { uploadData } from '../storage.service.js';
import { LinkType, getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service.js';
import { IService } from '../types/IService.js';
import { ITraceabilityEvent, ITraceabilityEventContext } from '../types';
import { constructIdentifierString, constructVerifyURL, generateUUID } from '../utils/helpers.js';
import { validateTraceabilityEventContext } from '../validateContext.js';
import { EPCISBusinessStepCode, EPCISEventAction, EPCISEventDisposition, EPCISEventType } from '../types/epcis.js';

export const processAggregationEvent: IService = async (
  aggregationEvent: ITraceabilityEvent,
  context: ITraceabilityEventContext,
): Promise<any> => {
  const validationResult = validateTraceabilityEventContext(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { vckit, traceabilityEvent, dlr, storage, identifierKeyPath } = context;

  const parentIdentifier = constructIdentifierString(aggregationEvent.data, identifierKeyPath);
  if (!parentIdentifier) {
    throw new Error('Identifier not found');
  }

  const { identifier, qualifierPath } = getLinkResolverIdentifier(parentIdentifier);

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
    traceabilityEvent.dlrIdentificationKeyType,
    identifier,
    traceabilityEvent.dlrLinkTitle,
    LinkType.epcisLinkType,
    traceabilityEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    qualifierPath,
  );

  return { vc: aggregationVC, decodedEnvelopedVC, linkResolver: aggregationLinkResolver };
};
