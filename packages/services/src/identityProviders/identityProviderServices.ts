import { IdentityProviderStrategy } from './IdentityProvider.js';
import { GS1Provider } from './GS1Provider.js';

/**
 * Factory function to get a provider instance based on the provider type.
 * @param {string} providerType - The type of provider.
 * @returns {ProviderStrategy} An instance of the provider strategy.
 */
export function getProviderByType(providerType: string): IdentityProviderStrategy {
  switch(providerType) {
    case 'gs1': 
      return new GS1Provider();

    default:
      // Default to GS1Provider if the provider type is not recognized.
      return new GS1Provider();
  }
}