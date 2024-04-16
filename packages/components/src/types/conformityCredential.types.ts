export type FetchOptions = {
  method: 'POST' | 'GET';
  headers?: any;
};

export interface IStoredCredentials {
  url: string;
  options: {
    bucket: string;
  };
}
export interface ICredentialRequestConfig {
  url: string;
  params: Record<string, string>;
  credentialName: string;
  credentialPath: string;
  options?: FetchOptions;
}

export interface IConformityCredentialProps {
  credentialRequestConfigs: ICredentialRequestConfig[];
  storedCredentials: IStoredCredentials;
}
