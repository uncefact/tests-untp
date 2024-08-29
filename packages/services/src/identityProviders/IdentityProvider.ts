export interface IdentityProviderStrategy {
  getDlrUrl: (code: string, providerUrl: string, namespace: string) => Promise<string | null>;
  getCode: (decodedText: string, formatName: string) => string;
}

export class IdentityProvider {
  private identityProviderStrategy: IdentityProviderStrategy;
  private identityProviderUrl: string;
  private identityProviderNamespace: string;

  constructor(identityProviderStrategy: IdentityProviderStrategy, identityProviderUrl: string) {
    this.identityProviderStrategy = identityProviderStrategy;
    this.identityProviderUrl = identityProviderUrl;
    this.identityProviderNamespace = 'gs1';
  }

  getDlrUrl(code: string): Promise<string | null> {
    return this.identityProviderStrategy.getDlrUrl(code, this.identityProviderUrl, this.identityProviderNamespace);
  }

  getCode(decodedText: string, formatName: string): string {
    return this.identityProviderStrategy.getCode(decodedText, formatName);
  }
}
