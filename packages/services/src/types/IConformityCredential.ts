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
