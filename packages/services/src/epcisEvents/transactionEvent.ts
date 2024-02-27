import { CredentialSubject, VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { issueVC } from '../vckit.service.js';
import { IContext } from './types.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { uploadJson } from '../storage.service.js';
import { generateUUID } from '../utils/helpers.js';
import { registerLinkResolver,DLREventEnum } from '../linkResolver.service.js';
import { validateContextObjectEvent } from './validateContext.js';

export interface ITransactionEvent {
  data: CredentialSubject;
}

export const processTransactionEvent: IService = async (transactionEvent: ITransactionEvent, context: IContext): Promise<VerifiableCredential> => {
  const validationResult = validateContextObjectEvent(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { data: credentialSubject } = transactionEvent;
  const { vckit, dpp, dlr, storage, identifierKeyPaths } = context;

  const identifier = getIdentifierByObjectKeyPaths(credentialSubject, identifierKeyPaths);
  if (!identifier) {
    throw new Error('Identifier not found');
  }

  const vc: VerifiableCredential = await issueVC({
    credentialSubject,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: dpp.context,
    render: dpp.renderTemplate,
    type: dpp.type,
  });

  const vcUrl = await uploadJson({
    filename: `${identifier}/${generateUUID()}`,
    json: vc,
    bucket: storage.bucket,
    storageAPIUrl: storage.storageAPIUrl,
  });

  await registerLinkResolver(
    vcUrl,
    dpp.dlrIdentificationKeyType,
    identifier,
    dpp.dlrLinkTitle,
    dpp.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    DLREventEnum.transaction,
  );

  return vc;
};

