export interface Credential {
  '@context': string[];
  type: string[];
  id?: string;
  [key: string]: any;
}

export type ArtefactSource = { kind: 'file'; filename: string } | { kind: 'url'; url: string };

export interface StoredCredential {
  original: any;
  decoded: Credential;
  source?: ArtefactSource;
}

export interface StoredScheme {
  original: any;
  decoded: Record<string, any>;
  source?: ArtefactSource;
}
