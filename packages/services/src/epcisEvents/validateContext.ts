import _ from 'lodash';
import { Result } from '../types/validateContext';
import { IConfigDLR, IContext, IEntityIssue, IStorageContext, IVCKitContext } from './types';

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

export const validateVckit = (vckit: any): Result<IVCKitContext> => {
  if (_.isEmpty(vckit.vckitAPIUrl)) return error('Invalid vckitAPIUrl');
  if (_.isEmpty(vckit.issuer)) return error('Invalid issuer');

  return { ok: true, value: vckit };
};

export const validateDpp = (dpp: any): Result<IEntityIssue> => {
  if (_.isEmpty(dpp.context)) return error('Invalid context');
  if (_.isEmpty(dpp.type)) return error('Invalid type');
  if (_.isEmpty(dpp.dlrLinkTitle)) return error('Invalid dlrLinkTitle');
  if (_.isEmpty(dpp.dlrVerificationPage)) return error('Invalid dlrVerificationPage');
  if (_.isEmpty(dpp.dlrIdentificationKeyType)) return error('Invalid dlrIdentificationKeyType');

  return { ok: true, value: dpp };
};

export const validateStorage = (storage: any): Result<IStorageContext> => {
  if (_.isEmpty(storage.storageAPIUrl)) return error('Invalid storageAPIUrl');
  if (_.isEmpty(storage.bucket)) return error('Invalid bucket');

  return { ok: true, value: storage };
};

export const validateDlr = (dlr: any): Result<IConfigDLR> => {
  if (_.isEmpty(dlr.dlrAPIUrl)) return error('Invalid dlrAPIUrl');
  if (_.isEmpty(dlr.dlrAPIKey)) return error('Invalid dlrAPIKey');

  return { ok: true, value: dlr };
};

export const validateIdentifierKeyPaths = (identifierKeyPaths: string[]): Result<string[]> => {
  if (identifierKeyPaths.length === 0) return error('Invalid identifierKeyPaths');

  return { ok: true, value: identifierKeyPaths };
};

/**
 * Validate context properties
 * @param context - event context
 * @returns Result<IContext>
 */
export const validateContext = (context: IContext): Result<IContext> => {
  try {
    const validationResult = checkContextProperties(context);
    if (!validationResult.ok) return error(validationResult.message);

    const vckitValidationResult = validateVckit(context.vckit);
    if (!vckitValidationResult.ok) return error(vckitValidationResult.message);

    const dppValidationResult = validateDpp(context.dpp);
    if (!dppValidationResult.ok) return error(dppValidationResult.message);

    const storageValidationResult = validateStorage(context.storage);
    if (!storageValidationResult.ok) return error(storageValidationResult.message);

    const dlrValidationResult = validateDlr(context.dlr);
    if (!dlrValidationResult.ok) return error(dlrValidationResult.message);

    const identifierKeyPathsValidationResult = validateIdentifierKeyPaths(context.identifierKeyPaths);
    if (!identifierKeyPathsValidationResult.ok) return error(identifierKeyPathsValidationResult.message);

    return { ok: true, value: context };
  } catch (error) {
    throw new Error(error.message ?? 'Error validating context');
  }
};

export const validateContextObjectEvent = validateContext;
