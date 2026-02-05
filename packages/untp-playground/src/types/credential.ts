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

interface CoreVersion {
  type: string;
  version: string;
}

interface ExtensionVersion {
  version: string;
  schema: string;
  core: CoreVersion;
}

export interface ExtensionConfig {
  domain: string;
  versions: ExtensionVersion[];
}
