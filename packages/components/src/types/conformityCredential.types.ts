export type FetchOptions = {
  method: 'POST' | 'GET';
  headers?: any;
};

export interface IStoredCredentialsConfig {
  url: string;

  options?: any;
  params?: any;
  type?: string;
}
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
  storedCredentialsConfig: IStoredCredentialsConfig;
}

export interface IConformityCredential {
  name: string;
  url: string;
  app: string;
}
