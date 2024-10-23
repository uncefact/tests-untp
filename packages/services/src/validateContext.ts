import _ from 'lodash';
import { Result } from './types/validateContext.js';
import {
  IContext,
  ITransactionEventContext,
  ITransformationEventContext,
  IObjectEventContext,
  IAssociationEventContext,
  IAggregationEventContext,
  IDppContext,
  IDigitalIdentityAnchorContext,
  IDigitalFacilityRecordContext,
} from './types/index.js';

export const error: <T>(message: string) => Result<T> = (message) => ({
  ok: false,
  value: message,
});

export const checkContextProperties = (context: IContext): Result<IContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPath)) return error('identifierKeyPath not found');

  return { ok: true, value: context };
};

/**
 * Validate context properties
 * @param context - event context
 * @returns Result<IContext>
 */
export const validateContextDPP = (context: IDppContext): Result<IContext> => {
  const validationResult = checkContextProperties(context);
  if (!validationResult.ok) return error(validationResult.value);

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.dpp)) return error('Invalid dpp context');
  if (_.isEmpty(context.dpp.context)) return error('Invalid dpp context');
  if (_.isEmpty(context.dpp.type)) return error('Invalid type');
  if (_.isEmpty(context.dpp.dlrLinkTitle)) return error('Invalid dlrLinkTitle');
  if (_.isEmpty(context.dpp.dlrVerificationPage)) return error('Invalid dlrVerificationPage');
  if (_.isEmpty(context.dpp.dlrIdentificationKeyType)) return error('Invalid dlrIdentificationKeyType');
  if (_.isEmpty(context.dpp.renderTemplate)) return error('Invalid dpp renderTemplate');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.linkRegisterPath)) return error('Invalid dlr linkRegisterPath');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};

export const validateContextTransformationEvent = (
  context: ITransformationEventContext,
): Result<ITransformationEventContext> => {
  const validationResult = checkContextProperties(context);
  if (!validationResult.ok) return error(validationResult.value);

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.dpp)) return error('Invalid dpp context');
  if (_.isEmpty(context.dpp.context)) return error('Invalid dpp context');
  if (_.isEmpty(context.dpp.type)) return error('Invalid dpp type');
  if (_.isEmpty(context.dpp.dlrLinkTitle)) return error('Invalid dpp dlrLinkTitle');
  if (_.isEmpty(context.dpp.dlrVerificationPage)) return error('Invalid dpp dlrVerificationPage');
  if (_.isEmpty(context.dpp.dlrIdentificationKeyType)) return error('Invalid dpp dlrIdentificationKeyType');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.linkRegisterPath)) return error('Invalid dlr linkRegisterPath');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  if (_.isEmpty(context.epcisTransformationEvent)) return error('epcisTransformationEvent not found');
  if (_.isEmpty(context.epcisTransformationEvent.context)) return error('Invalid epcisTransformationEvent context');
  if (_.isEmpty(context.epcisTransformationEvent.type)) return error('Invalid epcisTransformationEvent type');
  if (_.isEmpty(context.epcisTransformationEvent.dlrLinkTitle))
    return error('Invalid epcisTransformationEvent dlrLinkTitle');
  if (_.isEmpty(context.epcisTransformationEvent.dlrVerificationPage))
    return error('Invalid epcisTransformationEvent dlrVerificationPage');
  if (_.isEmpty(context.epcisTransformationEvent.dlrIdentificationKeyType))
    return error('Invalid epcisTransformationEvent dlrIdentificationKeyType');
  if (_.isEmpty(context.epcisTransformationEvent.renderTemplate))
    return error('Invalid epcisTransformationEvent renderTemplate');

  if (_.isEmpty(context.dppCredentials)) return error('dppCredentials not found');

  return { ok: true, value: context };
};

export const validateTransactionEventContext = (
  context: ITransactionEventContext,
): Result<ITransactionEventContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.epcisTransactionEvent)) return error('Invalid epcisTransactionEvent context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPath)) return error('identifierKeyPath not found');

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.epcisTransactionEvent.context)) return error('Invalid epcisTransactionEvent context');
  if (_.isEmpty(context.epcisTransactionEvent.type)) return error('Invalid epcisTransactionEvent type');
  if (_.isEmpty(context.epcisTransactionEvent.dlrLinkTitle)) return error('Invalid epcisTransactionEvent dlrLinkTitle');
  if (_.isEmpty(context.epcisTransactionEvent.dlrVerificationPage))
    return error('Invalid epcisTransactionEvent dlrVerificationPage');
  if (_.isEmpty(context.epcisTransactionEvent.dlrIdentificationKeyType))
    return error('Invalid epcisTransactionEvent dlrIdentificationKeyType');
  if (_.isEmpty(context.epcisTransactionEvent.renderTemplate))
    return error('Invalid epcisTransactionEvent renderTemplate');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.linkRegisterPath)) return error('Invalid dlr linkRegisterPath');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};

export const validateAggregationEventContext = (
  context: IAggregationEventContext,
): Result<IAggregationEventContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.epcisAggregationEvent)) return error('Invalid epcisAggregationEvent context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPath)) return error('identifierKeyPath not found');

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.epcisAggregationEvent.context)) return error('Invalid epcisAggregationEvent context');
  if (_.isEmpty(context.epcisAggregationEvent.type)) return error('Invalid epcisAggregationEvent type');
  if (_.isEmpty(context.epcisAggregationEvent.dlrLinkTitle)) return error('Invalid epcisAggregationEvent dlrLinkTitle');
  if (_.isEmpty(context.epcisAggregationEvent.dlrVerificationPage))
    return error('Invalid epcisAggregationEvent dlrVerificationPage');
  if (_.isEmpty(context.epcisAggregationEvent.dlrIdentificationKeyType))
    return error('Invalid epcisAggregationEvent dlrIdentificationKeyType');
  if (_.isEmpty(context.epcisAggregationEvent.renderTemplate))
    return error('Invalid epcisAggregationEvent renderTemplate');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.linkRegisterPath)) return error('Invalid dlr linkRegisterPath');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};

export const validateObjectEventContext = (context: IObjectEventContext): Result<IObjectEventContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.epcisObjectEvent)) return error('Invalid epcisObjectEvent context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPath)) return error('identifierKeyPath not found');

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.epcisObjectEvent.context)) return error('Invalid epcisObjectEvent context');
  if (_.isEmpty(context.epcisObjectEvent.type)) return error('Invalid epcisObjectEvent type');
  if (_.isEmpty(context.epcisObjectEvent.dlrLinkTitle)) return error('Invalid epcisObjectEvent dlrLinkTitle');
  if (_.isEmpty(context.epcisObjectEvent.dlrVerificationPage))
    return error('Invalid epcisObjectEvent dlrVerificationPage');
  if (_.isEmpty(context.epcisObjectEvent.dlrIdentificationKeyType))
    return error('Invalid epcisObjectEvent dlrIdentificationKeyType');
  if (_.isEmpty(context.epcisObjectEvent.renderTemplate)) return error('Invalid epcisObjectEvent renderTemplate');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.linkRegisterPath)) return error('Invalid dlr linkRegisterPath');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};

export const validateDigitalIdentityAnchorContext = (
  context: IDigitalIdentityAnchorContext,
): Result<IDigitalIdentityAnchorContext> => {
  const validationResult = checkContextProperties(context);
  if (!validationResult.ok) return error(validationResult.value);

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.digitalIdentityAnchor)) return error('Invalid digitalIdentityAnchor context');
  if (_.isEmpty(context.digitalIdentityAnchor.context)) return error('Invalid digitalIdentityAnchor context');
  if (_.isEmpty(context.digitalIdentityAnchor.type)) return error('Invalid type');
  if (_.isEmpty(context.digitalIdentityAnchor.dlrLinkTitle)) return error('Invalid dlrLinkTitle');
  if (_.isEmpty(context.digitalIdentityAnchor.dlrVerificationPage)) return error('Invalid dlrVerificationPage');
  if (_.isEmpty(context.digitalIdentityAnchor.dlrIdentificationKeyType))
    return error('Invalid dlrIdentificationKeyType');
  if (_.isEmpty(context.digitalIdentityAnchor.renderTemplate))
    return error('Invalid digitalIdentityAnchor renderTemplate');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.linkRegisterPath)) return error('Invalid dlr linkRegisterPath');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};

export const validateDigitalFacilityRecordContext = (
  context: IDigitalFacilityRecordContext,
): Result<IDigitalFacilityRecordContext> => {
  const validationResult = checkContextProperties(context);
  if (!validationResult.ok) return error(validationResult.value);

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.digitalFacilityRecord)) return error('Invalid digitalFacilityRecord context');
  if (_.isEmpty(context.digitalFacilityRecord.context)) return error('Invalid digitalFacilityRecord context');
  if (_.isEmpty(context.digitalFacilityRecord.type)) return error('Invalid type');
  if (_.isEmpty(context.digitalFacilityRecord.dlrLinkTitle)) return error('Invalid dlrLinkTitle');
  if (_.isEmpty(context.digitalFacilityRecord.dlrVerificationPage)) return error('Invalid dlrVerificationPage');
  if (_.isEmpty(context.digitalFacilityRecord.dlrIdentificationKeyType))
    return error('Invalid dlrIdentificationKeyType');
  if (_.isEmpty(context.digitalFacilityRecord.renderTemplate))
    return error('Invalid digitalFacilityRecord renderTemplate');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.linkRegisterPath)) return error('Invalid dlr linkRegisterPath');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};

export const validateAssociationEventContext = (
  context: IAssociationEventContext,
): Result<IAssociationEventContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.epcisAssociationEvent)) return error('Invalid epcisAssociationEvent context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPath)) return error('identifierKeyPath not found');

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.epcisAssociationEvent.context)) return error('Invalid epcisAssociationEvent context');
  if (_.isEmpty(context.epcisAssociationEvent.type)) return error('Invalid epcisAssociationEvent type');
  if (_.isEmpty(context.epcisAssociationEvent.dlrLinkTitle)) return error('Invalid epcisAssociationEvent dlrLinkTitle');
  if (_.isEmpty(context.epcisAssociationEvent.dlrVerificationPage))
    return error('Invalid epcisAssociationEvent dlrVerificationPage');
  if (_.isEmpty(context.epcisAssociationEvent.dlrIdentificationKeyType))
    return error('Invalid epcisAssociationEvent dlrIdentificationKeyType');
  if (_.isEmpty(context.epcisAssociationEvent.renderTemplate))
    return error('Invalid epcisAssociationEvent renderTemplate');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.linkRegisterPath)) return error('Invalid dlr linkRegisterPath');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};
