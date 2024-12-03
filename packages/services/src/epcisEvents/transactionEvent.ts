import { VerifiableCredential } from '@vckit/core-types';
import { IService, ITraceabilityEvent, ITraceabilityEventContext } from '../types/index.js';
import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { uploadData } from '../storage.service.js';
import { constructVerifyURL, generateUUID } from '../utils/helpers.js';
import { LinkType, registerLinkResolver } from '../linkResolver.service.js';
import { validateTraceabilityEventContext } from '../validateContext.js';
import { deleteValuesFromLocalStorageByKeyPath } from './helpers.js';
import { constructIdentifierData, constructQualifierPath } from '../identifierSchemes/identifierSchemeServices.js';

export const processTransactionEvent: IService = async (
  transactionEvent: ITraceabilityEvent,
  context: ITraceabilityEventContext,
): Promise<any> => {
  const validationResult = validateTraceabilityEventContext(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { vckit, traceabilityEvent, dlr, storage, identifierKeyPath, localStorageParams } = context;

  const aiData = constructIdentifierData(identifierKeyPath, transactionEvent.data);
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

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: transactionEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: traceabilityEvent.context,
    type: traceabilityEvent.type,
    restOfVC,
  });

  const decodedEnvelopedVC = decodeEnvelopedVC(vc);
  const { uri, key, hash } = await uploadData(storage, vc, credentialId);
  const verifyURL = constructVerifyURL({ uri, key, hash });

  const linkResolver = await registerLinkResolver(
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

  deleteValuesFromLocalStorageByKeyPath(
    localStorageParams.storageKey,
    transactionEvent.data,
    localStorageParams.keyPath,
  );

  return { vc, decodedEnvelopedVC, linkResolver };
};
