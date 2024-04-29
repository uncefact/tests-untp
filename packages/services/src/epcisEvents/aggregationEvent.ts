import { VerifiableCredential } from '@vckit/core-types';
import { issueVC } from '../vckit.service.js';
import { getStorageServiceLink } from '../storage.service.js';
import { IdentificationKeyType, registerLinkResolver } from '../linkResolver.service.js';
import { IService } from '../types/IService.js';
import { ITraceabilityEvent, IAggregationEventContext } from './types';
import { generateUUID } from '../utils/helpers.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { validateAggregationEventContext } from './validateContext.js';
import { EPCISBusinessStepCode, EPCISEventAction, EPCISEventDisposition, EPCISEventType } from '../types/epcis.js';

export const processAggregationEvent: IService = async (
  aggregationEvent: ITraceabilityEvent,
  context: IAggregationEventContext,
): Promise<VerifiableCredential> => {
  const validationResult = validateAggregationEventContext(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { vckit, epcisAggregationEvent, dlr, storage, identifierKeyPaths } = context;
  const identifier: string = getIdentifierByObjectKeyPaths(aggregationEvent.data, identifierKeyPaths);
  if (!identifier) {
    throw new Error('Identifier not found');
  }

  const credentialSubject = {
    ...aggregationEvent.data,
    eventID: generateUUID(),
    eventType: EPCISEventType.Aggregation,
    eventTime: new Date().toISOString(),
    actionCode: EPCISEventAction.Add,
    dispositionCode: EPCISEventDisposition.InTransit,
    businessStepCode: EPCISBusinessStepCode.Packing,
    readPointId: generateUUID(),
  };

  const aggregationVC = await issueVC({
    credentialSubject,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: epcisAggregationEvent.context,
    type: epcisAggregationEvent.type,
    restOfVC: {
      render: epcisAggregationEvent.renderTemplate,
    },
  });
  
  const aggregationVCLink = await getStorageServiceLink(storage, aggregationVC, `${identifier}/${generateUUID()}`);

  await registerLinkResolver(
    aggregationVCLink,
    IdentificationKeyType.nlisid,
    identifier,
    epcisAggregationEvent.dlrLinkTitle,
    epcisAggregationEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey
  );

  return aggregationVC;
};
