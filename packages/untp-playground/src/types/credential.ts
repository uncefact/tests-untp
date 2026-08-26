export interface Credential {
  '@context': string[];
  type: string[];
  id?: string;
  [key: string]: any;
}

// `via: 'link-set'` marks a credential fetched from a link set's Verify action (#812); the
// credentials card uses it for the in-progress provenance subtitle. `requestedUrl` is the URL the
// user asked for when it differs from the stored (post-redirect) `url`, so URL bindings can name
// the ingestion under both forms.
export type ArtefactSource =
  | { kind: 'file'; filename: string }
  | { kind: 'url'; url: string; requestedUrl?: string; via?: 'link-set' };

export interface StoredCredential {
  /**
   * The instance is a still-encrypted envelope awaiting its key (#813): the card renders the
   * locked decrypt panel instead of a pipeline, until decryption replaces the payload.
   */
  encryptedEnvelope?: true;
  /**
   * The instance was decrypted in the browser this session (#813): its pipeline gains a leading
   * successful Decryption step.
   */
  decryptedFromEnvelope?: true;
  original: any;
  decoded: Credential;
  source?: ArtefactSource;
}

export interface StoredScheme {
  original: any;
  decoded: Record<string, any>;
  source?: ArtefactSource;
}

export interface StoredLinkSet {
  original: any;
  decoded: Record<string, any>;
  source?: ArtefactSource;
}
