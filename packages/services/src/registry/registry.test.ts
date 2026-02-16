import { adapterRegistry } from './registry';
import { ServiceType, AdapterType } from './types';
import { VCKitDidAdapter } from '../did-manager/adapters/vckit/vckit-did.adapter';
import { VCKitVerifiableCredentialService } from '../verifiable-credential/adapters/vckit/vckit-verifiable-credential.adapter';
import type { LoggerService } from '../logging/types';

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

describe('adapterRegistry', () => {
  describe('structure', () => {
    it('has a DID service entry', () => {
      expect(adapterRegistry[ServiceType.DID]).toBeDefined();
    });

    it('has a VCKIT adapter under DID', () => {
      expect(adapterRegistry[ServiceType.DID][AdapterType.VCKIT]).toBeDefined();
    });

    it('exposes configSchema and factory for VCKIT DID adapter', () => {
      const entry = adapterRegistry[ServiceType.DID][AdapterType.VCKIT];
      expect(entry.configSchema).toBeDefined();
      expect(typeof entry.factory).toBe('function');
    });
  });

  describe('factory', () => {
    it('creates a VCKitDidAdapter instance with valid config', () => {
      const entry = adapterRegistry[ServiceType.DID][AdapterType.VCKIT];
      const parsed = entry.configSchema.parse({
        endpoint: 'https://vckit.example.com',
        authToken: 'my-secret-token',
        keyType: 'Ed25519',
      });
      const service = entry.factory(parsed, mockLogger);

      expect(service).toBeInstanceOf(VCKitDidAdapter);
    });

    it('passes endpoint, auth header, and keyType to VCKitDidAdapter', () => {
      const entry = adapterRegistry[ServiceType.DID][AdapterType.VCKIT];
      const parsed = entry.configSchema.parse({
        endpoint: 'https://vckit.example.com',
        authToken: 'my-secret-token',
        keyType: 'Ed25519',
      });
      const service = entry.factory(parsed, mockLogger) as VCKitDidAdapter;

      expect(service.baseURL).toBe('https://vckit.example.com');
      expect(service.headers).toEqual({ Authorization: 'Bearer my-secret-token' });
      expect(service.keyType).toBe('Ed25519');
    });

    it('uses schema-parsed config so keyType default flows through', () => {
      const entry = adapterRegistry[ServiceType.DID][AdapterType.VCKIT];
      const parsed = entry.configSchema.parse({
        endpoint: 'https://vckit.example.com',
        authToken: 'my-secret-token',
      });
      const service = entry.factory(parsed, mockLogger) as VCKitDidAdapter;

      expect(service.keyType).toBe('Ed25519');
    });
  });

  describe('configSchema validation', () => {
    const schema = adapterRegistry[ServiceType.DID][AdapterType.VCKIT].configSchema;

    it('accepts valid config', () => {
      const result = schema.safeParse({
        endpoint: 'https://vckit.example.com',
        authToken: 'bearer-token-123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing endpoint', () => {
      const result = schema.safeParse({
        authToken: 'bearer-token-123',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-URL endpoint', () => {
      const result = schema.safeParse({
        endpoint: 'not-a-url',
        authToken: 'bearer-token-123',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty authToken', () => {
      const result = schema.safeParse({
        endpoint: 'https://vckit.example.com',
        authToken: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing authToken', () => {
      const result = schema.safeParse({
        endpoint: 'https://vckit.example.com',
      });
      expect(result.success).toBe(false);
    });

    it('defaults keyType to Ed25519 when omitted', () => {
      const result = schema.safeParse({
        endpoint: 'https://vckit.example.com',
        authToken: 'bearer-token-123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keyType).toBe('Ed25519');
      }
    });

    it('rejects unsupported keyType', () => {
      const result = schema.safeParse({
        endpoint: 'https://vckit.example.com',
        authToken: 'bearer-token-123',
        keyType: 'Secp256k1',
      });
      expect(result.success).toBe(false);
    });
  });

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
          endpoint: 'https://vckit.example.com',
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
          endpoint: 'https://vckit.example.com',
          apiKey: 'my-api-key',
        });
        expect(result.success).toBe(true);
      });

      it('rejects missing endpoint', () => {
        const result = schema.safeParse({
          apiKey: 'my-api-key',
        });
        expect(result.success).toBe(false);
      });

      it('rejects non-URL endpoint', () => {
        const result = schema.safeParse({
          endpoint: 'not-a-url',
          apiKey: 'my-api-key',
        });
        expect(result.success).toBe(false);
      });

      it('rejects missing apiKey', () => {
        const result = schema.safeParse({
          endpoint: 'https://vckit.example.com',
        });
        expect(result.success).toBe(false);
      });

      it('rejects empty apiKey', () => {
        const result = schema.safeParse({
          endpoint: 'https://vckit.example.com',
          apiKey: '',
        });
        expect(result.success).toBe(false);
      });
    });
  });
});
