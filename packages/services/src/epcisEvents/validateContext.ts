import _ from 'lodash';
import { Result } from '../types/validateContext';
import { IContext } from './types';

export const error: <T>(message: string) => Result<T> = (message) => ({
  ok: false,
  message: message,
});

export const checkContextProperties = (context: IContext): Result<IContext> => {
  if (_.isEmpty(context.vckit)) return error('Invalid vckit context');
  if (_.isEmpty(context.dpp)) return error('Invalid dpp context');
  if (_.isEmpty(context.storage)) return error('Invalid storage context');
  if (_.isEmpty(context.dlr)) return error('Invalid dlr context');
  if (_.isEmpty(context.identifierKeyPaths)) return error('Identifier not found');

  return { ok: true, value: context };
};

/**
 * Validate context properties
 * @param context - event context
 * @returns Result<IContext>
 */
export const validateContextObjectEvent = (context: IContext): Result<IContext> => {
  try {
    const validationResult = checkContextProperties(context);
    if (!validationResult.ok) return error(validationResult.message);

    if (_.isEmpty(context.vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
    if (_.isEmpty(context.vckit.issuer)) return error('Invalid issuer');

    if (_.isEmpty(context.dpp.context)) return error('Invalid context');
    if (_.isEmpty(context.dpp.type)) return error('Invalid type');
    if (_.isEmpty(context.dpp.dlrLinkTitle)) return error('Invalid dlrLinkTitle');
    if (_.isEmpty(context.dpp.dlrVerificationPage)) return error('Invalid dlrVerificationPage');
    if (_.isEmpty(context.dpp.dlrIdentificationKeyType)) return error('Invalid dlrIdentificationKeyType');

    if (_.isEmpty(context.storage.storageAPIUrl)) return error('Invalid storageAPIUrl');
    if (_.isEmpty(context.storage.bucket)) return error('Invalid bucket');

    if (_.isEmpty(context.dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
    if (_.isEmpty(context.dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');

    if (context.identifierKeyPaths.length === 0) return error('Invalid identifierKeyPaths');

    return { ok: true, value: context };
  } catch (error) {
    throw new Error(error.message ?? 'Error validating context');
  }
};
