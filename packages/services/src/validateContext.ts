import _ from 'lodash';
import { Result } from './types/validateContext.js';
import {
  IContext,
  ITransformationEventContext,
  IDppContext,
  IDigitalIdentityAnchorContext,
  IDigitalFacilityRecordContext,
  IDigitalConformityCredentialContext,
  ITraceabilityEventContext,
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

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
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

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
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

  if (_.isEmpty(context.dppCredentials)) return error('dppCredentials not found');

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

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
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

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};

export const validateDigitalConformityCredentialContext = (
  context: IDigitalConformityCredentialContext,
): Result<IDigitalConformityCredentialContext> => {
  const validationResult = checkContextProperties(context);
  if (!validationResult.ok) return error(validationResult.value);

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.digitalConformityCredential)) return error('Invalid digitalConformityCredential context');
  if (_.isEmpty(context.digitalConformityCredential.context))
    return error('Invalid digitalConformityCredential context');
  if (_.isEmpty(context.digitalConformityCredential.type)) return error('Invalid type');
  if (_.isEmpty(context.digitalConformityCredential.dlrLinkTitle)) return error('Invalid dlrLinkTitle');
  if (_.isEmpty(context.digitalConformityCredential.dlrVerificationPage)) return error('Invalid dlrVerificationPage');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};

export const validateTraceabilityEventContext = (
  context: ITraceabilityEventContext,
): Result<ITraceabilityEventContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.traceabilityEvent)) return error('Invalid traceabilityEvent context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPath)) return error('identifierKeyPath not found');

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.traceabilityEvent.context)) return error('Invalid traceabilityEvent context');
  if (_.isEmpty(context.traceabilityEvent.type)) return error('Invalid traceabilityEvent type');
  if (_.isEmpty(context.traceabilityEvent.dlrLinkTitle)) return error('Invalid traceabilityEvent dlrLinkTitle');
  if (_.isEmpty(context.traceabilityEvent.dlrVerificationPage))
    return error('Invalid traceabilityEvent dlrVerificationPage');

  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.storage.url)) return error('Invalid storage url');
  if (_.isEmpty(context.storage.params)) return error('Invalid storage params');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');
  if (_.isEmpty(context.dlr.namespace)) return error('Invalid dlr namespace');

  return { ok: true, value: context };
};
