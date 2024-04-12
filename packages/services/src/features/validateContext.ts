import _ from 'lodash';
import { Result } from '../types/validateContext';
import { IContext } from '../types';

export const error: <T>(message: string) => Result<T> = (message) => ({
  ok: false,
  value: message,
});

export const checkContextConformityServiceProperties = (context: IContext): Result<IContext> => {
  if (_.isEmpty(context.credentialRequestConfig)) return error('Invalid credentialRequestConfig context');
  if (_.isEmpty(context.uploadCredentialConfig)) return error('Invalid uploadCredentialConfig context');

  if (_.some(context.credentialRequestConfig, (config) => _.isEmpty(config.url)))
    return error('Invalid credentialRequestConfig url context');
  if (_.isEmpty(context.uploadCredentialConfig.url)) return error('Invalid uploadCredentialConfig url context');
  return { ok: true, value: context };
};
