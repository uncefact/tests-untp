export type FetchOptions = {
  method: 'POST' | 'GET';
  headers?: any;
};

export type RequestConfig = {
  url: string;
  params: any;
  options?: FetchOptions;
};

export interface IFetchFunction {
  (config: RequestConfig): Promise<any | string>;
}

export interface IContext {
  [key: string]: any;
}

export type ExtendedOptions =
  FetchOptions & {
    bucket?: string;
  };

export interface IUploadCredentialConfig {
  url: string;
  options: ExtendedOptions;
  params: any;
}
