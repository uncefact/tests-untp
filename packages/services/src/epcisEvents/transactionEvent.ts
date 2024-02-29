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

export interface ITransactionData {
  sender: string
  receiver: string;
  locationUrl: string;
  industryType: string;
  transaction: {
    type: string;
    identifier: string;
    documentURL: string;
  };
  livestockIds: string[];
}

export const processTransactionEvent: IService = async (transactionEvent: ITransactionEvent, context: IContext): Promise<VerifiableCredential> => {
  const validationResult = validateContextObjectEvent(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { sender, receiver, locationUrl, industryType, transaction, livestockIds = [] } = transactionEvent.data as ITransactionData;
  const { vckit, dpp, dlr, storage, identifierKeyPaths } = context;

  const [senderName, senderPartyID] = splitStringByDash(sender || '');
  const [receiverName, receiverPartyID] = splitStringByDash(receiver || '');

  const itemList = livestockIds.map((livestockId: string) => {
    const linkResolver = `${dlr.dlrAPIUrl}/${dpp.dlrIdentificationKeyType}/${livestockId}?linkType=all`;
    return {
      name: industryType,
      itemID: livestockId,
      link: linkResolver,
    };
  });

  const credentialSubject = {
    sourceParty: { partyID: senderPartyID, name: senderName },
    destinationParty: { partyID: receiverPartyID, name: receiverName },
    transaction,
    itemList,
    eventID: generateUUID(),
    eventType: DLREventEnum.Transaction,
    eventTime: new Date().toUTCString(),
    actionCode: EPCISEventAction.Observe,
    dispositionCode: EPCISEventDisposition.InTransit,
    businessStepCode: generateUUID(),
    readPointId: generateUUID(),
    locationId: locationUrl,
  };

  const identifiers = getIdentifierByObjectKeyPaths(transactionEvent.data, identifierKeyPaths);
  if (!identifiers) {
    throw new Error('Identifier not found');
  }

  const vc: VerifiableCredential = await issueVC({
    credentialSubject,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: dpp.context,
    type: dpp.type,
    restOfVC: {
      render: dpp.renderTemplate
    }
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
