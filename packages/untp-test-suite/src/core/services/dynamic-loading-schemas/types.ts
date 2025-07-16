export interface IDynamicLoadingSchemaService {
  (type: string, version: string, url?: string): Promise<JSON> | string;
}
