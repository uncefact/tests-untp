import { VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { issueVC } from '../vckit.service.js';
import { ITraceabilityEvent, ITransactionEventContext } from './types.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { uploadJson } from '../storage.service.js';
import { generateUUID } from '../utils/helpers.js';
import { registerLinkResolver } from '../linkResolver.service.js';
import { validateTransactionEventContext } from './validateContext.js';
import { EPCISEventAction, EPCISEventDisposition, EPCISEventType } from '../types/epcis.js';

export const processTransactionEvent: IService = async (transactionEvent: ITraceabilityEvent, context: ITransactionEventContext): Promise<VerifiableCredential> => {
  const validationResult = validateTransactionEventContext(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { vckit, epcisTransactionEvent, dlr, storage, identifierKeyPaths } = context;
  const identifier: string = getIdentifierByObjectKeyPaths(transactionEvent.data, identifierKeyPaths);
  if (!identifier) {
    throw new Error('Identifier not found');
  }

  const credentialSubject = {
    ...transactionEvent.data,
    eventID: generateUUID(),
    eventType: EPCISEventType.Transaction,
    eventTime: new Date().toISOString(),
    actionCode: EPCISEventAction.Observe,
    dispositionCode: EPCISEventDisposition.InTransit,
    businessStepCode: generateUUID(),
    readPointId: generateUUID(),
  };
  const vc: VerifiableCredential = await issueVC({
    credentialSubject,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: epcisTransactionEvent.context,
    type: epcisTransactionEvent.type,
    restOfVC: {
      render: epcisTransactionEvent.renderTemplate
    }
  });

  const vcUrl = await uploadJson({
    filename: `${identifier}/${generateUUID()}`,
    json: vc,
    bucket: storage.bucket,
    storageAPIUrl: storage.storageAPIUrl,
  });

  await registerLinkResolver(
    vcUrl,
    epcisTransactionEvent.dlrIdentificationKeyType,
    identifier,
    epcisTransactionEvent.dlrLinkTitle,
    epcisTransactionEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
  );

  return vc;
};
