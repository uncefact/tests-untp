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

interface VersionConfig {
  version: string;
  schema: string;
  core: {
    type: string;
    version: string;
  };
}

export interface ExtensionConfig {
  domain: string;
  versions: VersionConfig[];
}
