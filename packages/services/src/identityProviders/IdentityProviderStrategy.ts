export interface IdentityProviderStrategy {
  getDlrUrl: (code: string, providerUrl: string) => Promise<string | null>;
  getCode: (decodedText: string, formatName: string) => string;
}