import { VerifiableCredential } from '@vckit/core-types';
import { issueVC } from '../vckit.service.js';
import { uploadJson } from '../storage.service.js';
import { IdentificationKeyType, registerLinkResolver } from '../linkResolver.service.js';
import { IService } from '../types/IService.js';
import { IAggregationEvent, IContext } from './types';
import { generateUUID } from '../utils/helpers.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { validateContextObjectEvent } from './validateContext.js';
import { EPCISEventAction, EPCISEventDisposition, EPCISEventType } from '../types/epcis.js';

export const processAggregationEvent: IService = async (aggregationEvent: IAggregationEvent,context: IContext): Promise<VerifiableCredential> => {
  const validationResult = validateContextObjectEvent(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  const { parentItem, childItems, childQuantityList, locationId } = aggregationEvent.data;
  const { vckit, dpp, dlr, storage, identifierKeyPaths } = context;

  const identifier: string = getIdentifierByObjectKeyPaths(aggregationEvent.data, identifierKeyPaths);
  if (!identifier) {
    throw new Error('Identifier not found');
  }

  const parentItemDLRUri = `${dlr.dlrAPIUrl}/${dpp.dlrIdentificationKeyType}/${parentItem.itemID}?linkType=all`;
  const credentialSubject = {
    eventID: generateUUID(),
    eventType: EPCISEventType.Aggregation,
    eventTime: new Date().toUTCString(),
    actionCode: EPCISEventAction.Observe,
    dispositionCode: EPCISEventDisposition.InTransit,
    businessStepCode: generateUUID(),
    readPointId: generateUUID(),
    locationId,
    parentItem: {
      itemID: parentItemDLRUri,
      name: parentItem.name,
    },
    childItems,
    childQuantityList,
  };

  const aggregationVC = await issueVC({
    credentialSubject,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: dpp.context,
    type: dpp.type,
    restOfVC: {
      render: dpp.renderTemplate,
    },
  });

  const aggregationVCLink = await uploadJson({
    filename: `${identifier}/${generateUUID()}`,
    json: aggregationVC,
    bucket: storage.bucket,
    storageAPIUrl: storage.storageAPIUrl,
  });

  await registerLinkResolver(
    aggregationVCLink,
    IdentificationKeyType.nlisid,
    identifier,
    dpp.dlrLinkTitle,
    dpp.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey
  );

  return aggregationVC;
};
