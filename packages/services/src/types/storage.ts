export type StorageServiceOptions = {
  method: 'POST' | 'PUT';
  headers?: any;
};

export type StorageServiceParams = {
  resultPath: string;
  [key: string]: any;
};

export type StorageServiceConfig = {
  url: string;
  params: StorageServiceParams;
  options?: StorageServiceOptions;
};

export interface IStorageService {
  (config: StorageServiceConfig): Promise<string>;
}

export interface IUploadData {
  (storage: StorageServiceConfig, data: any, filename: string): Promise<any>;
}
