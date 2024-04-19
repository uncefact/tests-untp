export type FetchOptions = {
  method: 'POST' | 'GET';
  headers?: any;
};

export interface IStoredCredentials {
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
  credentialAppExclusive: string;
  options?: FetchOptions;
}

export interface IConformityCredentialProps {
  credentialRequestConfigs: ICredentialRequestConfig[];
  storedCredentials: IStoredCredentials;
}

export interface IConformityCredential {
  name: string;
  url: string;
  app: string;
}
