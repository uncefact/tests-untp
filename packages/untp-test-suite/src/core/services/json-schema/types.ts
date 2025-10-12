import { ErrorObject } from 'ajv';

export interface IHasErrors {
  (schema: any, data: any): null | ErrorObject[];
}
