import { Gs1Provider, ProviderStrategy } from '@mock-app/services';

export function getProviderInstance(providerType: string, providerUrl: string): ProviderStrategy {
  switch(providerType) {
    case 'gs1': 
      return new Gs1Provider(providerType, providerUrl);

    default:
      return new Gs1Provider(providerType, providerUrl);
  }
}