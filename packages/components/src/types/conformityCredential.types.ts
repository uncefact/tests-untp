export type FetchOptions = {
  method: 'POST' | 'GET';
  headers?: any;
};

export interface IStoredCredentials {
  url: string;
  options: {
    bucket: string;
  };

  [key: string]: any;
}
export interface ICredentialRequestConfig {
  url: string;
  params: Record<string, string>;
  credentialName: string;
  credentialPath: string;
  credentialAppExclusive: string;
  options?: FetchOptions;
}

export interface IConformityCredentialProps {
  credentialRequestConfigs: ICredentialRequestConfig[];
  storedCredentials: IStoredCredentials;
}
