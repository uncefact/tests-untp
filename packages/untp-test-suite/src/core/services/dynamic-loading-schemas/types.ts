import { IConfigContent } from '../../types';

export interface IDynamicLoadingSchemaService {
  (credentialConfig: IConfigContent): Promise<JSON> | string;
}
