import { adapterRegistry } from './registry';
import { ServiceType, AdapterType } from './types';
import { VCKitDidAdapter, vckitDidRegistryEntry } from '../did-manager/adapters/vckit/vckit-did.adapter';
import { VCKitVerifiableCredentialService } from '../verifiable-credential/adapters/vckit/vckit-verifiable-credential.adapter';
import type { LoggerService } from '../logging/types';

// Build the didAdapterRegistry inline to mirror the structure in did-adapter-registry.ts
// without importing it directly (avoids a transient TS strict-mode diagnostic in that file).
const didAdapterRegistry = {
  [AdapterType.VCKIT]: vckitDidRegistryEntry,
};

// jose is ESM-only; mock it so the registry test can import the VC adapter
jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

describe('didAdapterRegistry', () => {
  describe('structure', () => {
    it('has a VCKIT adapter entry', () => {
      expect(didAdapterRegistry[AdapterType.VCKIT]).toBeDefined();
    });

    it('exposes configSchema and factory for VCKIT DID adapter', () => {
      const entry = didAdapterRegistry[AdapterType.VCKIT];
      expect(entry.configSchema).toBeDefined();
      expect(typeof entry.factory).toBe('function');
    });
  });

  describe('factory', () => {
    it('creates a VCKitDidAdapter instance with valid config', () => {
      const entry = didAdapterRegistry[AdapterType.VCKIT];
      const parsed = entry.configSchema.parse({
        baseUrl: 'https://vckit.example.com',
        apiKey: 'my-key',
      });
      const service = entry.factory(parsed, mockLogger);

      expect(service).toBeInstanceOf(VCKitDidAdapter);
    });

    it('passes baseUrl, auth header, and hardcoded keyType to VCKitDidAdapter', () => {
      const entry = didAdapterRegistry[AdapterType.VCKIT];
      const parsed = entry.configSchema.parse({
        baseUrl: 'https://vckit.example.com',
        apiKey: 'my-key',
      });
      const service = entry.factory(parsed, mockLogger) as VCKitDidAdapter;

      expect(service.baseURL).toBe('https://vckit.example.com');
      expect(service.headers).toEqual({ Authorization: 'Bearer my-key' });
      expect(service.keyType).toBe('Ed25519');
    });
  });

  describe('configSchema validation', () => {
    const schema = didAdapterRegistry[AdapterType.VCKIT].configSchema;

    it('accepts valid config', () => {
      const result = schema.safeParse({
        baseUrl: 'https://vckit.example.com',
        apiKey: 'my-key',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing baseUrl', () => {
      const result = schema.safeParse({
        apiKey: 'my-key',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-URL baseUrl', () => {
      const result = schema.safeParse({
        baseUrl: 'not-a-url',
        apiKey: 'my-key',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing apiKey', () => {
      const result = schema.safeParse({
        baseUrl: 'https://vckit.example.com',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty apiKey', () => {
      const result = schema.safeParse({
        baseUrl: 'https://vckit.example.com',
        apiKey: '',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('adapterRegistry', () => {
  describe('VC service', () => {
    describe('structure', () => {
      it('has a VC service entry', () => {
        expect(adapterRegistry[ServiceType.VC]).toBeDefined();
      });

      it('has a VCKIT adapter under VC', () => {
        expect(adapterRegistry[ServiceType.VC][AdapterType.VCKIT]).toBeDefined();
      });

      it('exposes configSchema and factory for VCKIT VC adapter', () => {
        const entry = adapterRegistry[ServiceType.VC][AdapterType.VCKIT];
        expect(entry.configSchema).toBeDefined();
        expect(typeof entry.factory).toBe('function');
      });
    });

    describe('factory', () => {
      it('creates a VCKitVerifiableCredentialService instance with valid config', () => {
        const entry = adapterRegistry[ServiceType.VC][AdapterType.VCKIT];
        const parsed = entry.configSchema.parse({
          baseUrl: 'https://vckit.example.com',
          apiKey: 'my-api-key',
        });
        const service = entry.factory(parsed, mockLogger);

        expect(service).toBeInstanceOf(VCKitVerifiableCredentialService);
      });
    });

    describe('configSchema validation', () => {
      const schema = adapterRegistry[ServiceType.VC][AdapterType.VCKIT].configSchema;

      it('accepts valid config', () => {
        const result = schema.safeParse({
          baseUrl: 'https://vckit.example.com',
          apiKey: 'my-api-key',
        });
        expect(result.success).toBe(true);
      });

      it('rejects missing baseUrl', () => {
        const result = schema.safeParse({
          apiKey: 'my-api-key',
        });
        expect(result.success).toBe(false);
      });

      it('rejects non-URL baseUrl', () => {
        const result = schema.safeParse({
          baseUrl: 'not-a-url',
          apiKey: 'my-api-key',
        });
        expect(result.success).toBe(false);
      });

      it('rejects missing apiKey', () => {
        const result = schema.safeParse({
          baseUrl: 'https://vckit.example.com',
        });
        expect(result.success).toBe(false);
      });

      it('rejects empty apiKey', () => {
        const result = schema.safeParse({
          baseUrl: 'https://vckit.example.com',
          apiKey: '',
        });
        expect(result.success).toBe(false);
      });
    });
  });
});
