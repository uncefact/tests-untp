import { IDLRAI } from '../epcisEvents/types';

export interface IdentityProviderStrategy {
  getDlrUrl: (code: string, providerUrl: string) => Promise<string | null>;
  getCode: (decodedText: string, formatName: string) => string;
  getLinkResolverIdentifier: (dlrAIs: IDLRAI[]) => { identifier: string, qualifierPath: string };
}

export class IdentityProvider {
  private identityProviderStrategy: IdentityProviderStrategy;
  private identityProviderUrl: string;

  constructor(identityProviderStrategy: IdentityProviderStrategy, identityProviderUrl: string) {
    this.identityProviderStrategy = identityProviderStrategy;
    this.identityProviderUrl = identityProviderUrl;
  }

  getDlrUrl(code: string): Promise<string | null> {
    return this.identityProviderStrategy.getDlrUrl(code, this.identityProviderUrl);
  }

  getCode(decodedText: string, formatName: string): string {
    return this.identityProviderStrategy.getCode(decodedText, formatName);
  }

  getLinkResolverIdentifier(dlrAIs: IDLRAI[]): { identifier: string, qualifierPath: string } {
    return this.identityProviderStrategy.getLinkResolverIdentifier(dlrAIs);
  }
}
