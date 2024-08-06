import { VerifiableCredential } from '@vckit/core-types';
import JSONPointer from 'jsonpointer';
import { LinkType, getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service.js';
import { getStorageServiceLink } from '../storage.service.js';
import { IService } from '../types/index.js';
import { generateUUID } from '../utils/helpers.js';
import { issueVC } from '../vckit.service.js';
import { deleteValuesFromLocalStorageByKeyPath } from './helpers.js';
import { ITraceabilityEvent, ITransactionEventContext } from './types.js';
import { validateTransactionEventContext } from './validateContext.js';

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
    vcKitAPIKey: vckit?.vckitAPIKey,
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
    epcisTransactionEvent.dlrIdentificationKeyType,
    identifier,
    epcisTransactionEvent.dlrLinkTitle,
    LinkType.epcisLinkType,
    epcisTransactionEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
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
