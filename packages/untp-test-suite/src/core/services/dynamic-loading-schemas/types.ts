export interface IDynamicLoadingSchemaService {
  (schema: string, version: string): unknown;
}
