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
  AdapterType: { VCKIT: 'VCKIT', PYX_IDR: 'PYX_IDR', UNCEFACT_STORAGE: 'UNCEFACT_STORAGE', VCKIT_VC: 'VCKIT_VC' },
}));

// Mock the server entrypoint (runtime registry)
const mockFactory = jest.fn();
const mockConfigSchema = {
  safeParse: jest.fn(),
};
jest.mock('@uncefact/untp-ri-services/server', () => ({
  adapterRegistry: {
    VC: {
      VCKIT_VC: {
        configSchema: mockConfigSchema,
        factory: (...args: unknown[]) => mockFactory(...args),
      },
    },
  },
}));

import { resolveVcService } from './resolve-vc-service';
import { SYSTEM_TENANT_ID } from '@/lib/prisma/constants';

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
  id: 'vc-inst-1',
  tenantId: SYSTEM_TENANT_ID,
  serviceType: 'VC',
  adapterType: 'VCKIT_VC',
  name: 'System VCKit VC',
  config: JSON.stringify(MOCK_ENCRYPTED_ENVELOPE),
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_CONFIG = {
  baseUrl: 'https://vckit.example.com',
  authToken: 'tok',
};
const VALID_JSON = JSON.stringify(VALID_CONFIG);

const MOCK_SERVICE = {
  issueCredential: jest.fn(),
  verifyCredential: jest.fn(),
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

describe('resolveVcService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves VC service from system default', async () => {
    setupHappyPath();

    const result = await resolveVcService('org-1');

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'VC', undefined);
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
    expect(result).toEqual({ service: MOCK_SERVICE, instanceId: 'vc-inst-1' });
  });

  it('resolves using explicit instance ID when provided', async () => {
    setupHappyPath();

    await resolveVcService('org-1', 'explicit-vc-inst');

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'VC', 'explicit-vc-inst');
  });

  it('throws ServiceInstanceNotFoundError for explicit ID not found', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    await expect(resolveVcService('org-1', 'missing-id')).rejects.toThrow(ServiceInstanceNotFoundError);
  });

  it('throws ServiceResolutionError when no instance found', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    await expect(resolveVcService('org-1')).rejects.toThrow(ServiceResolutionError);
  });

  it('throws ConfigDecryptionError on decrypt failure', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    mockEncryptionService.decrypt.mockImplementation(() => {
      throw new Error('bad key');
    });

    await expect(resolveVcService('org-1')).rejects.toThrow(ConfigDecryptionError);
  });

  it('throws ConfigValidationError on invalid JSON', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    mockEncryptionService.decrypt.mockReturnValue('not-json{{{');

    await expect(resolveVcService('org-1')).rejects.toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError on schema validation failure', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    mockEncryptionService.decrypt.mockReturnValue(VALID_JSON);
    mockConfigSchema.safeParse.mockReturnValue({
      success: false,
      error: {
        issues: [{ message: 'endpoint is required' }, { message: 'authToken must be a string' }],
      },
    });

    await expect(resolveVcService('org-1')).rejects.toThrow(ConfigValidationError);
    await expect(resolveVcService('org-1')).rejects.toThrow(/endpoint is required, authToken must be a string/);
  });

  it('returns the adapter and instance ID from the factory (end-to-end flow)', async () => {
    setupHappyPath();

    const result = await resolveVcService('tenant-abc');

    // Verify the complete chain executed
    expect(mockGetInstanceByResolution).toHaveBeenCalledTimes(1);
    expect(mockEncryptionService.decrypt).toHaveBeenCalledTimes(1);
    expect(mockConfigSchema.safeParse).toHaveBeenCalledTimes(1);
    expect(mockFactory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ service: MOCK_SERVICE, instanceId: 'vc-inst-1' });
  });
});
