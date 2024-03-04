import _ from 'lodash';
import { Result } from '../types/validateContext';
import { IContext, ITransactionEventContext, ITransformationEvent } from './types';

export const error: <T>(message: string) => Result<T> = (message) => ({
  ok: false,
  value: message,
});

export const checkContextProperties = (context: IContext): Result<IContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.dpp)) return error('Invalid dpp context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPaths)) return error('identifierKeyPaths not found');

  return { ok: true, value: context };
};

/**
 * Validate context properties
 * @param context - event context
 * @returns Result<IContext>
 */
export const validateContextObjectEvent = (context: IContext): Result<IContext> => {
  const validationResult = checkContextProperties(context);
  if (!validationResult.ok) return error(validationResult.value);

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.dpp.context)) return error('Invalid dpp context');
  if (_.isEmpty(context.dpp.type)) return error('Invalid type');
  if (_.isEmpty(context.dpp.dlrLinkTitle)) return error('Invalid dlrLinkTitle');
  if (_.isEmpty(context.dpp.dlrVerificationPage)) return error('Invalid dlrVerificationPage');
  if (_.isEmpty(context.dpp.dlrIdentificationKeyType)) return error('Invalid dlrIdentificationKeyType');

  if (_.isEmpty(context.storage.storageAPIUrl)) return error('Invalid storageAPIUrl');
  if (_.isEmpty(context.storage.bucket)) return error('Invalid bucket');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');

  return { ok: true, value: context };
};

export const validateContextTransformationEvent = (context: ITransformationEvent): Result<ITransformationEvent> => {
  const validationResult = checkContextProperties(context);
  if (!validationResult.ok) return error(validationResult.value);

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if (_.isEmpty(context.dpp.context)) return error('Invalid dpp context');
  if (_.isEmpty(context.dpp.type)) return error('Invalid dpp type');
  if (_.isEmpty(context.dpp.dlrLinkTitle)) return error('Invalid dpp dlrLinkTitle');
  if (_.isEmpty(context.dpp.dlrVerificationPage)) return error('Invalid dpp dlrVerificationPage');
  if (_.isEmpty(context.dpp.dlrIdentificationKeyType)) return error('Invalid dpp dlrIdentificationKeyType');

  if (_.isEmpty(context.storage.storageAPIUrl)) return error('Invalid storageAPIUrl');
  if (_.isEmpty(context.storage.bucket)) return error('Invalid bucket');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');

  if(_.isEmpty(context.epcisTransformationEvent)) return error('epcisTransformationEvent not found');
  if(_.isEmpty(context.epcisTransformationEvent.context)) return error('Invalid epcisTransformationEvent context')
  if(_.isEmpty(context.epcisTransformationEvent.type)) return error('Invalid epcisTransformationEvent type')
  if(_.isEmpty(context.epcisTransformationEvent.dlrLinkTitle)) return error('Invalid epcisTransformationEvent dlrLinkTitle')
  if(_.isEmpty(context.epcisTransformationEvent.dlrVerificationPage)) return error('Invalid epcisTransformationEvent dlrVerificationPage')
  if(_.isEmpty(context.epcisTransformationEvent.dlrIdentificationKeyType)) return error('Invalid epcisTransformationEvent dlrIdentificationKeyType')
  
  return { ok: true, value: context };
};

export const validateTransactionEventContext = (context: ITransactionEventContext): Result<ITransactionEventContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.epcisTransactionEvent)) return error('Invalid epcisTransactionEvent context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPaths)) return error('identifierKeyPaths not found');

  if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

  if(_.isEmpty(context.epcisTransactionEvent)) return error('epcisTransactionEvent not found');
  if(_.isEmpty(context.epcisTransactionEvent.context)) return error('Invalid epcisTransactionEvent context')
  if(_.isEmpty(context.epcisTransactionEvent.type)) return error('Invalid epcisTransactionEvent type')
  if(_.isEmpty(context.epcisTransactionEvent.dlrLinkTitle)) return error('Invalid epcisTransactionEvent dlrLinkTitle')
  if(_.isEmpty(context.epcisTransactionEvent.dlrVerificationPage)) return error('Invalid epcisTransactionEvent dlrVerificationPage')
  if(_.isEmpty(context.epcisTransactionEvent.dlrIdentificationKeyType)) return error('Invalid epcisTransactionEvent dlrIdentificationKeyType')

  if (_.isEmpty(context.storage.storageAPIUrl)) return error('Invalid storageAPIUrl');
  if (_.isEmpty(context.storage.bucket)) return error('Invalid bucket');

  if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');

  return { ok: true, value: context };
};