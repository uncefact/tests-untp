import { CredentialSubject, VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { issueVC } from '../vckit.service.js';
import { IContext } from './types.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { uploadJson } from '../storage.service.js';
import { generateUUID, splitStringByDash } from '../utils/helpers.js';
import { registerLinkResolver, DLREventEnum, EPCISEventAction, EPCISEventDisposition } from '../linkResolver.service.js';
import { validateContextObjectEvent } from './validateContext.js';

export interface ITransactionEvent {
  data: CredentialSubject;
}

export const processTransactionEvent: IService = async (transactionEvent: ITransactionEvent, context: IContext): Promise<VerifiableCredential> => {
  const validationResult = validateContextObjectEvent(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const [senderName, senderPartyID] = splitStringByDash(transactionEvent.data?.sender || '');
  const [receiverName, receiverPartyID] = splitStringByDash(transactionEvent.data?.receiver || '');

  const credentialSubject = {
    sourceParty: { partyID: senderPartyID, name: senderName },
    destinationParty: { partyID: receiverPartyID, name: receiverName },
    itemList: transactionEvent?.data?.livestockIds || [],
    readPointId: generateUUID(),
    eventID: generateUUID(),
    eventTime: new Date().toUTCString(),
    eventType: DLREventEnum.Transaction,
    actionCode: EPCISEventAction.Observe,
    dispositionCode: EPCISEventDisposition.InTransit,
  };
  const { vckit, dpp, dlr, storage, identifierKeyPaths } = context;

  const identifiers = getIdentifierByObjectKeyPaths(transactionEvent.data, identifierKeyPaths);
  if (!identifiers) {
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

  await Promise.all(
    (identifiers as string[]).map(async (identifier) => {
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
        DLREventEnum.Transaction,
      );
    }),
  );

  return vc;
};
