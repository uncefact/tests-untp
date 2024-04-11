export interface IdentityProviderStrategy {
  getDlrUrl: (code: string, providerUrl: string) => string | null;
  getCode: (decodedText: string, formatName: string) => string;
}

export class IdentityProvider {
  private identityProviderStrategy: IdentityProviderStrategy;
  private identityProviderUrl: string;

  constructor(identityProviderStrategy: IdentityProviderStrategy, identityProviderUrl: string) {
    this.identityProviderStrategy = identityProviderStrategy;
    this.identityProviderUrl = identityProviderUrl;
  }

  getDlrUrl(code: string): string | null {
    return this.identityProviderStrategy.getDlrUrl(code, this.identityProviderUrl);
  }

  getCode(decodedText: string, formatName: string): string {
    return this.identityProviderStrategy.getCode(decodedText, formatName);
  }
}
