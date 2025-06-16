export interface Credential {
  '@context': string[];
  type: string[];
  id?: string;
  [key: string]: any;
}

export interface StoredCredential {
  original: any;
  decoded: Credential;
}
