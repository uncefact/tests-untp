import { StorageServiceConfig } from '@mock-app/services/build/types';

export type FetchOptions = {
  method: 'POST' | 'GET';
  headers?: any;
};

export interface ICredentialRequestConfig {
  url: string;
  params: any;
  credentialName: string;
  credentialPath: string;
  appOnly: string;
  options?: FetchOptions;
}

export interface IConformityCredentialProps {
  credentialRequestConfigs: ICredentialRequestConfig[];
  storedCredentialsConfig: StorageServiceConfig;
}

export interface IConformityCredential {
  name: string;
  url: string;
  app: string;
}

export interface IVerifyURLPayload {
  uri: string;
  key?: string;
  hash?: string;
}
