import { IdentityProviderStrategy } from './identityProviderStrategy.js';

export class IdentityProvder {
  private identityProviderStrategy: IdentityProviderStrategy;
  private identityProviderUrl: string;

  constructor(identityProviderStrategy: IdentityProviderStrategy, identityProviderUrl: string) {
    this.identityProviderStrategy = identityProviderStrategy;
    this.identityProviderUrl = identityProviderUrl;
  }

  async getDlrUrl(code: string): Promise<string | null> {
    return this.identityProviderStrategy.getDlrUrl(code, this.identityProviderUrl);
  }

  getCode(decodedText: string, formatName: string): string {
    return this.identityProviderStrategy.getCode(decodedText, formatName);
  }
}
