import { ProviderStrategy } from './ProviderStrategy.js';
import { Gs1Provider } from './gs1Provider.js';

export class Provider {
  private identityProvider: ProviderStrategy;

  /**
   * Creates an instance of Provider.
   * @param {ProviderStrategy} identityProvider - The identity provider strategy to use.
   */
  constructor(identityProvider: ProviderStrategy) {
    this.identityProvider = identityProvider;
  }

  /**
   * Retrieves the DLR (Digital Link Resolver) URL from the underlying identity provider.
   * @returns {Promise<string | null>} A Promise resolving to the DLR URL, or null if not available.
   */
  async getDlrUrl(): Promise<string | null> {
    return this.identityProvider.getDlrUrl();
  }

  /**
   * Sets the code for the underlying identity provider.
   * @param {string} code - The code to set.
   */
  setCode(code: string) {
    this.identityProvider.setCode(code);
  }

  /**
   * Extracts the code from decoded text based on the format name using the underlying identity provider.
   * @param {string} decodedText - The decoded text.
   * @param {string} formatName - The format name.
   * @returns {string} The extracted code.
   */
  getCode(decodedText: string, formatName: string): string {
    return this.identityProvider.getCode(decodedText, formatName);
  }

  /**
   * Checks if the underlying identity provider is supported.
   * @returns {boolean} True if supported, otherwise false.
   */
  isProviderSupported(): boolean {
    return this.identityProvider.isProviderSupported();
  }
}

/**
 * Factory function to get a provider instance based on the provider type.
 * @param {string} providerType - The type of provider.
 * @param {string} providerUrl - The URL for the provider.
 * @returns {ProviderStrategy} An instance of the provider strategy.
 */
export function getProviderByType(providerType: string, providerUrl: string): ProviderStrategy {
  switch(providerType) {
    case 'gs1': 
      return new Gs1Provider(providerType, providerUrl);

    default:
      // Default to Gs1Provider if the provider type is not recognized.
      return new Gs1Provider(providerType, providerUrl);
  }
}
