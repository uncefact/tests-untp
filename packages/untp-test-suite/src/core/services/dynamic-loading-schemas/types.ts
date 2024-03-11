export interface IDynamicLoadingSchemaService {
  (schema: string, version: string): Promise<JSON>;
}
