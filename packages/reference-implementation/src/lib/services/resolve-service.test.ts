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
  ServiceType: { DID: 'DID', IDR: 'IDR', STORAGE: 'STORAGE', VC: 'VC' },
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
  tenantId: 'system',
  serviceType: 'STORAGE',
  adapterType: 'UNCEFACT_STORAGE',
  name: 'System UNCEFACT Storage',
  config: JSON.stringify(MOCK_ENCRYPTED_ENVELOPE),
  apiVersion: '1.0.0',
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
  (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(VALID_JSON);
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

    await resolveService('org-1', 'STORAGE' as any, 'explicit-inst');

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'STORAGE', 'explicit-inst');
  });

  it('falls back to tenant primary / system default', async () => {
    setupHappyPath();

    const result = await resolveService('org-1', 'STORAGE' as any);

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

    await expect(resolveService('org-1', 'STORAGE' as any, 'missing-id')).rejects.toThrow(ServiceInstanceNotFoundError);
  });

  it('throws ServiceResolutionError when no instance found', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    await expect(resolveService('org-1', 'STORAGE' as any)).rejects.toThrow(ServiceResolutionError);
  });

  it('throws ConfigDecryptionError when decryption fails', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    (mockEncryptionService.decrypt as jest.Mock).mockImplementation(() => {
      throw new Error('bad key');
    });

    await expect(resolveService('org-1', 'STORAGE' as any)).rejects.toThrow(ConfigDecryptionError);
  });

  it('throws ConfigValidationError when config is invalid JSON', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    (mockEncryptionService.decrypt as jest.Mock).mockReturnValue('not-json{{{');

    await expect(resolveService('org-1', 'STORAGE' as any)).rejects.toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when config fails schema validation', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(VALID_JSON);
    mockConfigSchema.safeParse.mockReturnValue({
      success: false,
      error: {
        issues: [{ message: 'baseUrl is required' }, { message: 'bucket must be a string' }],
      },
    });

    await expect(resolveService('org-1', 'STORAGE' as any)).rejects.toThrow(ConfigValidationError);
    await expect(resolveService('org-1', 'STORAGE' as any)).rejects.toThrow(
      /baseUrl is required, bucket must be a string/,
    );
  });

  it('throws ConfigValidationError when adapter not in registry', async () => {
    const instanceWithUnknownAdapter = {
      ...MOCK_INSTANCE,
      adapterType: 'UNKNOWN_ADAPTER',
    };
    mockGetInstanceByResolution.mockResolvedValue(instanceWithUnknownAdapter);
    (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(VALID_JSON);

    await expect(resolveService('org-1', 'STORAGE' as any)).rejects.toThrow(ConfigValidationError);
  });

  it('returns the adapter and instance ID from the factory (end-to-end flow)', async () => {
    setupHappyPath();

    const result = await resolveService('tenant-abc', 'STORAGE' as any);

    // Verify the complete chain executed
    expect(mockGetInstanceByResolution).toHaveBeenCalledTimes(1);
    expect(mockEncryptionService.decrypt).toHaveBeenCalledTimes(1);
    expect(mockConfigSchema.safeParse).toHaveBeenCalledTimes(1);
    expect(mockFactory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ service: MOCK_SERVICE, instanceId: 'storage-inst-1' });
  });
});
