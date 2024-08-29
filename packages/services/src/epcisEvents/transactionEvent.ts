import { VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { issueVC } from '../vckit.service.js';
import { ITraceabilityEvent, ITransactionEventContext } from './types.js';
import { getStorageServiceLink } from '../storage.service.js';
import { generateUUID } from '../utils/helpers.js';
import { LinkType, getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service.js';
import { validateTransactionEventContext } from './validateContext.js';
import JSONPointer from 'jsonpointer';
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
  const transactionIdentifier = JSONPointer.get(transactionEvent.data, identifierKeyPath);
  if (!transactionIdentifier) {
    throw new Error('Identifier not found');
  }

  const { identifier, qualifierPath } = getLinkResolverIdentifier(transactionIdentifier);

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: transactionEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: epcisTransactionEvent.context,
    type: epcisTransactionEvent.type,
    restOfVC: {
      render: epcisTransactionEvent.renderTemplate,
    },
  });

  const vcUrl = await getStorageServiceLink(storage, vc, `${identifier}/${generateUUID()}`);

  const linkResolver = await registerLinkResolver(
    vcUrl,
    epcisTransactionEvent.dlrIdentificationKeyNamespace,
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
