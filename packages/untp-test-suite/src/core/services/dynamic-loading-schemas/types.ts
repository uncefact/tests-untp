import { ICredentialConfigError } from '../../types';

export interface IDynamicLoadingSchemaService {
  (schema: string, version: string, url?: string, dataPath?: any): Promise<JSON> | ICredentialConfigError;
}
