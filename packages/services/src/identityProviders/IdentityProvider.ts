export interface IdentityProviderStrategy {
  getDlrUrl: (code: string, providerUrl: string, namespace?: string) => Promise<string | null>;
  getCode: (decodedText: string, formatName: string) => string;
}

export class IdentityProvider {
  private identityProviderStrategy: IdentityProviderStrategy;
  private identityProviderUrl: string;

  constructor(identityProviderStrategy: IdentityProviderStrategy, identityProviderUrl: string) {
    this.identityProviderStrategy = identityProviderStrategy;
    this.identityProviderUrl = identityProviderUrl;
  }

  getDlrUrl(code: string, namespace?: string): Promise<string | null> {
    return this.identityProviderStrategy.getDlrUrl(code, this.identityProviderUrl, namespace);
  }

  getCode(decodedText: string, formatName: string): string {
    return this.identityProviderStrategy.getCode(decodedText, formatName);
  }
}