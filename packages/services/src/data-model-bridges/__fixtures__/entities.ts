import type {
  OrganisationEntity,
  FacilityEntity,
  ProductEntity,
  ConformityInput,
  BridgeEntities,
  DataModelConfig,
} from '../types.js';

export function createOrganisation(overrides?: Partial<OrganisationEntity>): OrganisationEntity {
  return {
    id: 'did:web:example.com:org:1',
    name: 'Test Organisation',
    description: 'A test organisation for unit tests',
    primaryIdentifier: {
      value: '9520123456788',
      scheme: { id: 'https://id.gs1.org/01/', name: 'Global Trade Item Number (GTIN)' },
    },
    ...overrides,
  };
}

export function createFacility(overrides?: Partial<FacilityEntity>): FacilityEntity {
  return {
    id: 'did:web:example.com:facility:1',
    name: 'Test Facility',
    description: 'A test facility for unit tests',
    primaryIdentifier: {
      value: '4012345000009',
      scheme: { id: 'https://id.gs1.org/414/', name: 'Global Location Number (GLN)' },
    },
    location: {
      address: {
        streetAddress: '123 Test Street',
        postalCode: '2000',
        addressLocality: 'Sydney',
        addressRegion: 'NSW',
        addressCountry: 'AU',
      },
      plusCode: '4RRH469X+VF',
      geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
    },
    ...overrides,
  };
}

export function createProduct(overrides?: Partial<ProductEntity>): ProductEntity {
  return {
    id: 'did:web:example.com:product:1',
    name: 'Test Product',
    description: 'A test product for unit tests',
    level: 'BATCH',
    batchNumber: 'BATCH-001',
    primaryIdentifier: {
      value: '9520123456788',
      scheme: { id: 'https://id.gs1.org/01/', name: 'Global Trade Item Number (GTIN)' },
    },
    ...overrides,
  };
}

export function createConformityInput(overrides?: Partial<ConformityInput>): ConformityInput {
  return {
    scheme: {
      id: 'https://example.org/conformity-scheme',
      name: 'Test Conformity Scheme',
    },
    standard: {
      id: 'https://example.org/standard/1.0',
      name: 'Test Standard 1.0',
    },
    regulation: {
      id: 'https://example.org/regulation/1.0',
      name: 'Test Regulation 1.0',
    },
    criteria: [
      {
        id: 'https://example.org/criteria/1',
        name: 'Test Criterion 1',
        conformityTopic: 'environment.emissions',
      },
      {
        id: 'https://example.org/criteria/2',
        name: 'Test Criterion 2',
        conformityTopic: 'environment.energy',
      },
    ],
    ...overrides,
  };
}

export function createBridgeEntities(overrides?: Partial<BridgeEntities>): BridgeEntities {
  return {
    organisation: createOrganisation(),
    facility: createFacility(),
    product: createProduct(),
    ...overrides,
  };
}

export function createCoreConfig(overrides?: Partial<DataModelConfig>): DataModelConfig {
  return {
    core: {
      contextUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/',
      credentialType: 'DigitalProductPassport',
    },
    ...overrides,
  };
}
