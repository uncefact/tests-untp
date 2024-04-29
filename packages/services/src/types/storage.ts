export type StorageServiceOptions = {
    method: 'POST' | 'PUT';
    headers?: any;
  };
  
export type StorageServiceConfig = {
  url: string;
  params: any;
  options?: StorageServiceOptions;
};

export interface IStorageService {
  (config: StorageServiceConfig): Promise<string>;
}
