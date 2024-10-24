import { VerifiableCredential } from '@vckit/core-types';
import { IService, ITraceabilityEvent, ITransactionEventContext } from '../types/index.js';
import { issueVC } from '../vckit.service.js';
import { uploadData } from '../storage.service.js';
import { constructIdentifierString, generateUUID } from '../utils/helpers.js';
import { LinkType, getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service.js';
import { validateTransactionEventContext } from '../validateContext.js';
import { deleteValuesFromLocalStorageByKeyPath } from './helpers.js';

export const processTransactionEvent: IService = async (
  transactionEvent: ITraceabilityEvent,
  context: ITransactionEventContext,
): Promise<any> => {
  const validationResult = validateTransactionEventContext(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { vckit, epcisTransactionEvent, dlr, storage, identifierKeyPath, localStorageParams } = context;
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
    context: epcisTransactionEvent.context,
    type: epcisTransactionEvent.type,
    restOfVC: {
      render: epcisTransactionEvent.renderTemplate,
    },
  });

  const vcUrl = await uploadData(storage, vc, generateUUID());

  const linkResolver = await registerLinkResolver(
    vcUrl,
    epcisTransactionEvent.dlrIdentificationKeyType,
    identifier,
    epcisTransactionEvent.dlrLinkTitle,
    LinkType.epcisLinkType,
    epcisTransactionEvent.dlrVerificationPage,
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

  return { vc, linkResolver };
};
