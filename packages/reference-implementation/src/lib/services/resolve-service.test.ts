// Mock next/server (jsdom environment)
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock encryption module BEFORE any imports that depend on it
const mockEncryptionService = {
  encrypt: jest.fn(),
  decrypt: jest.fn(),
};
jest.mock('@/lib/encryption/encryption', () => ({
  getEncryptionService: () => mockEncryptionService,
}));

// Mock repository
const mockGetInstanceByResolution = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  getInstanceByResolution: (...args: unknown[]) => mockGetInstanceByResolution(...args),
}));

// Mock the services package (types only from main barrel)
jest.mock('@uncefact/untp-ri-services', () => ({
  ServiceType: { IDR: 'IDR', STORAGE: 'STORAGE', VC: 'VC' },
  AdapterType: { VCKIT: 'VCKIT', PYX_IDR: 'PYX_IDR', UNCEFACT_STORAGE: 'UNCEFACT_STORAGE' },
}));

// Mock the server entrypoint (runtime registry)
const mockFactory = jest.fn();
const mockConfigSchema = {
  safeParse: jest.fn(),
};
jest.mock('@uncefact/untp-ri-services/server', () => ({
  adapterRegistry: {
    STORAGE: {
      UNCEFACT_STORAGE: {
        configSchema: mockConfigSchema,
        factory: (...args: unknown[]) => mockFactory(...args),
      },
    },
  },
}));

import { resolveService } from './resolve-service';
import { ServiceType } from '@uncefact/untp-ri-services';
import { SYSTEM_TENANT_ID } from '@/lib/prisma/constants';
import type { AdapterRegistryEntry } from '@uncefact/untp-ri-services';

import {
  ServiceResolutionError,
  ServiceInstanceNotFoundError,
  ConfigDecryptionError,
  ConfigValidationError,
} from '@/lib/api/errors';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_ENCRYPTED_ENVELOPE = {
  cipherText: 'dGVzdA==',
  iv: 'aXYxMjM0NTY3ODkw',
  tag: 'dGFnMTIzNDU2Nzg5MDEyMzQ1Ng==',
  type: 'aes-256-gcm',
};

const MOCK_INSTANCE = {
  id: 'storage-inst-1',
  tenantId: SYSTEM_TENANT_ID,
  serviceType: 'STORAGE',
  adapterType: 'UNCEFACT_STORAGE',
  name: 'System UNCEFACT Storage',
  config: JSON.stringify(MOCK_ENCRYPTED_ENVELOPE),
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_CONFIG = {
  baseUrl: 'https://storage.example.com',
  apiVersion: '1.0.0',
  bucket: 'verifiable-credentials',
};
const VALID_JSON = JSON.stringify(VALID_CONFIG);

const MOCK_SERVICE = {
  store: jest.fn(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupHappyPath() {
  mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
  mockEncryptionService.decrypt.mockReturnValue(VALID_JSON);
  mockConfigSchema.safeParse.mockReturnValue({
    success: true,
    data: VALID_CONFIG,
  });
  mockFactory.mockReturnValue(MOCK_SERVICE);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves with explicit instance ID', async () => {
    setupHappyPath();

    await resolveService('org-1', ServiceType.STORAGE, 'explicit-inst');

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'STORAGE', 'explicit-inst');
  });

  it('falls back to tenant primary / system default', async () => {
    setupHappyPath();

    const result = await resolveService('org-1', ServiceType.STORAGE);

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'STORAGE', undefined);
    expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(MOCK_ENCRYPTED_ENVELOPE);
    expect(mockConfigSchema.safeParse).toHaveBeenCalledWith(VALID_CONFIG);
    expect(mockFactory).toHaveBeenCalledWith(
      VALID_CONFIG,
      expect.objectContaining({
        info: expect.any(Function),
        warn: expect.any(Function),
        error: expect.any(Function),
        debug: expect.any(Function),
      }),
    );
    expect(result).toEqual({ service: MOCK_SERVICE, instanceId: 'storage-inst-1' });
  });

  it('throws ServiceInstanceNotFoundError when explicit ID not found', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    await expect(resolveService('org-1', ServiceType.STORAGE, 'missing-id')).rejects.toThrow(
      ServiceInstanceNotFoundError,
    );
  });

  it('throws ServiceResolutionError when no instance found', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    await expect(resolveService('org-1', ServiceType.STORAGE)).rejects.toThrow(ServiceResolutionError);
  });

  it('throws ConfigDecryptionError when decryption fails', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    mockEncryptionService.decrypt.mockImplementation(() => {
      throw new Error('bad key');
    });

    await expect(resolveService('org-1', ServiceType.STORAGE)).rejects.toThrow(ConfigDecryptionError);
  });

  it('throws ConfigValidationError when config is invalid JSON', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    mockEncryptionService.decrypt.mockReturnValue('not-json{{{');

    await expect(resolveService('org-1', ServiceType.STORAGE)).rejects.toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when config fails schema validation', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    mockEncryptionService.decrypt.mockReturnValue(VALID_JSON);
    mockConfigSchema.safeParse.mockReturnValue({
      success: false,
      error: {
        issues: [{ message: 'baseUrl is required' }, { message: 'bucket must be a string' }],
      },
    });

    await expect(resolveService('org-1', ServiceType.STORAGE)).rejects.toThrow(ConfigValidationError);
    await expect(resolveService('org-1', ServiceType.STORAGE)).rejects.toThrow(
      /baseUrl is required, bucket must be a string/,
    );
  });

  it('throws ConfigValidationError when adapter not in registry', async () => {
    const instanceWithUnknownAdapter = {
      ...MOCK_INSTANCE,
      adapterType: 'UNKNOWN_ADAPTER',
    };
    mockGetInstanceByResolution.mockResolvedValue(instanceWithUnknownAdapter);
    mockEncryptionService.decrypt.mockReturnValue(VALID_JSON);

    await expect(resolveService('org-1', ServiceType.STORAGE)).rejects.toThrow(ConfigValidationError);
  });

  it('returns the adapter and instance ID from the factory (end-to-end flow)', async () => {
    setupHappyPath();

    const result = await resolveService('tenant-abc', ServiceType.STORAGE);

    // Verify the complete chain executed
    expect(mockGetInstanceByResolution).toHaveBeenCalledTimes(1);
    expect(mockEncryptionService.decrypt).toHaveBeenCalledTimes(1);
    expect(mockConfigSchema.safeParse).toHaveBeenCalledTimes(1);
    expect(mockFactory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ service: MOCK_SERVICE, instanceId: 'storage-inst-1' });
  });

  describe('adapterLookupOverride', () => {
    it('uses override registry when provided', async () => {
      // Instance has adapterType 'VCKIT' which is NOT in the standard adapterRegistry
      // (the standard registry only has STORAGE.UNCEFACT_STORAGE)
      const instanceWithVckit = {
        ...MOCK_INSTANCE,
        id: 'override-inst-1',
        serviceType: 'VC',
        adapterType: 'VCKIT',
      };
      mockGetInstanceByResolution.mockResolvedValue(instanceWithVckit);
      mockEncryptionService.decrypt.mockReturnValue(VALID_JSON);

      const overrideConfigSchema = {
        safeParse: jest.fn().mockReturnValue({ success: true, data: VALID_CONFIG }),
      };
      const overrideFactory = jest.fn().mockReturnValue(MOCK_SERVICE);
      const override = {
        VCKIT: {
          configSchema: overrideConfigSchema,
          sensitiveFields: ['apiKey'] as const,
          factory: overrideFactory,
        },
      } as unknown as Record<string, AdapterRegistryEntry>;

      const result = await resolveService('org-1', ServiceType.VC, undefined, override);

      expect(overrideConfigSchema.safeParse).toHaveBeenCalledWith(VALID_CONFIG);
      expect(overrideFactory).toHaveBeenCalledWith(
        VALID_CONFIG,
        expect.objectContaining({
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          debug: expect.any(Function),
        }),
      );
      // The standard registry factory should NOT have been called
      expect(mockFactory).not.toHaveBeenCalled();
      expect(result).toEqual({ service: MOCK_SERVICE, instanceId: 'override-inst-1' });
    });

    it('throws when override does not contain adapter type', async () => {
      mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
      mockEncryptionService.decrypt.mockReturnValue(VALID_JSON);

      // Empty override — has no entry for 'UNCEFACT_STORAGE'
      const emptyOverride = {} as Record<string, AdapterRegistryEntry>;

      await expect(resolveService('org-1', ServiceType.STORAGE, undefined, emptyOverride)).rejects.toThrow(
        ConfigValidationError,
      );

      await expect(resolveService('org-1', ServiceType.STORAGE, undefined, emptyOverride)).rejects.toThrow(
        /not registered/,
      );
    });
  });
});
