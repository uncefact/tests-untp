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
  ServiceType: { DID: 'DID', IDR: 'IDR' },
  AdapterType: { VCKIT: 'VCKIT', PYX_IDR: 'PYX_IDR' },
}));

// Mock the server entrypoint (runtime registry)
const mockFactory = jest.fn();
const mockConfigSchema = {
  safeParse: jest.fn(),
};
jest.mock('@uncefact/untp-ri-services/server', () => ({
  adapterRegistry: {
    IDR: {
      PYX_IDR: {
        configSchema: mockConfigSchema,
        factory: (...args: unknown[]) => mockFactory(...args),
      },
    },
  },
}));

import { resolveIdrService } from './resolve-idr-service';

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
  id: 'idr-inst-1',
  tenantId: 'system',
  serviceType: 'IDR',
  adapterType: 'PYX_IDR',
  name: 'System Pyx IDR',
  config: JSON.stringify(MOCK_ENCRYPTED_ENVELOPE),
  apiVersion: '1.0.0',
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_CONFIG = { baseUrl: 'https://idr.example.com', apiKey: 'test-key' };
const VALID_JSON = JSON.stringify(VALID_CONFIG);

const MOCK_SERVICE = {
  publishLinks: jest.fn(),
  getLinkById: jest.fn(),
  updateLink: jest.fn(),
  deleteLink: jest.fn(),
  getResolverDescription: jest.fn(),
  getLinkTypes: jest.fn(),
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

describe('resolveIdrService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves IDR service from system default', async () => {
    setupHappyPath();

    const result = await resolveIdrService('org-1');

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'IDR', undefined);
    expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(MOCK_ENCRYPTED_ENVELOPE);
    expect(mockConfigSchema.safeParse).toHaveBeenCalledWith(VALID_CONFIG);
    expect(mockFactory).toHaveBeenCalledWith(VALID_CONFIG, {
      name: 'PYX_IDR',
      version: '1.0.0',
      logger: expect.objectContaining({
        info: expect.any(Function),
        warn: expect.any(Function),
        error: expect.any(Function),
        debug: expect.any(Function),
      }),
    });
    expect(result).toEqual({ service: MOCK_SERVICE, instanceId: 'idr-inst-1' });
  });

  it('resolves using scheme IDR service instance ID when provided', async () => {
    setupHappyPath();

    await resolveIdrService('org-1', 'scheme-idr-inst');

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'IDR', 'scheme-idr-inst');
  });

  it('resolves using registrar IDR service instance ID when scheme has none', async () => {
    setupHappyPath();

    await resolveIdrService('org-1', null, 'registrar-idr-inst');

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'IDR', 'registrar-idr-inst');
  });

  it('prefers scheme IDR over registrar IDR', async () => {
    setupHappyPath();

    await resolveIdrService('org-1', 'scheme-idr', 'registrar-idr');

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'IDR', 'scheme-idr');
  });

  it('falls through to tenant/system resolution when both are null', async () => {
    setupHappyPath();

    await resolveIdrService('org-1', null, null);

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'IDR', undefined);
  });

  it('throws ServiceInstanceNotFoundError for explicit ID not found', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    await expect(resolveIdrService('org-1', 'missing-id')).rejects.toThrow(ServiceInstanceNotFoundError);
  });

  it('throws ServiceResolutionError when no instance found', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    await expect(resolveIdrService('org-1')).rejects.toThrow(ServiceResolutionError);
  });

  it('throws ConfigDecryptionError on decrypt failure', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    (mockEncryptionService.decrypt as jest.Mock).mockImplementation(() => {
      throw new Error('bad key');
    });

    await expect(resolveIdrService('org-1')).rejects.toThrow(ConfigDecryptionError);
  });

  it('throws ConfigValidationError on invalid JSON', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    (mockEncryptionService.decrypt as jest.Mock).mockReturnValue('not-json{{{');

    await expect(resolveIdrService('org-1')).rejects.toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError on schema validation failure', async () => {
    mockGetInstanceByResolution.mockResolvedValue(MOCK_INSTANCE);
    (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(VALID_JSON);
    mockConfigSchema.safeParse.mockReturnValue({
      success: false,
      error: {
        issues: [{ message: 'baseUrl is required' }, { message: 'apiKey must be a string' }],
      },
    });

    await expect(resolveIdrService('org-1')).rejects.toThrow(ConfigValidationError);
    await expect(resolveIdrService('org-1')).rejects.toThrow(/baseUrl is required, apiKey must be a string/);
  });

  it('returns the adapter and instance ID from the factory (end-to-end flow)', async () => {
    setupHappyPath();

    const result = await resolveIdrService('tenant-abc');

    // Verify the complete chain executed
    expect(mockGetInstanceByResolution).toHaveBeenCalledTimes(1);
    expect(mockEncryptionService.decrypt).toHaveBeenCalledTimes(1);
    expect(mockConfigSchema.safeParse).toHaveBeenCalledTimes(1);
    expect(mockFactory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ service: MOCK_SERVICE, instanceId: 'idr-inst-1' });
  });
});
