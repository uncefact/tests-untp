import { VerifiableCredential } from '@vckit/core-types';
import { IService, ITraceabilityEvent, ITraceabilityEventContext } from '../types/index.js';
import { decodeEnvelopedVC, issueVC } from '../vckit.service.js';
import { uploadData } from '../storage.service.js';
import { constructIdentifierString, generateUUID } from '../utils/helpers.js';
import { LinkType, getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service.js';
import { validateTraceabilityEventContext } from '../validateContext.js';
import { deleteValuesFromLocalStorageByKeyPath } from './helpers.js';

export const processTransactionEvent: IService = async (
  transactionEvent: ITraceabilityEvent,
  context: ITraceabilityEventContext,
): Promise<any> => {
  const validationResult = validateTraceabilityEventContext(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { vckit, traceabilityEvent, dlr, storage, identifierKeyPath, localStorageParams } = context;
  const transactionIdentifier = constructIdentifierString(transactionEvent.data, identifierKeyPath);
  if (!transactionIdentifier) {
    throw new Error('Identifier not found');
  }

  const { identifier, qualifierPath } = getLinkResolverIdentifier(transactionIdentifier);

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: transactionEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: traceabilityEvent.context,
    type: traceabilityEvent.type,
    restOfVC: {
      render: traceabilityEvent.renderTemplate,
    },
  });

  const decodedEnvelopedVC = decodeEnvelopedVC(vc);
  const vcUrl = await uploadData(storage, vc, generateUUID());

  const linkResolver = await registerLinkResolver(
    vcUrl,
    traceabilityEvent.dlrIdentificationKeyType,
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

  deleteValuesFromLocalStorageByKeyPath(
    localStorageParams.storageKey,
    transactionEvent.data,
    localStorageParams.keyPath,
  );

  return { vc, decodedEnvelopedVC, linkResolver };
};
