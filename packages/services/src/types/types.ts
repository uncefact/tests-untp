export interface IVerifyURLPayload {
  uri: string;
  /**
   * Multibase-encoded multihash of the credential bytes referenced by `uri`,
   * used by the verifier to detect integrity drift between issue and verify
   * time. Default encoding is `base58btc` (`z…`) with `sha2-256`. Decode via
   * `@uncefact/untp-utils/multibase-digest`.
   */
  digestMultibase: string;
  decryptionKey?: string;
}
