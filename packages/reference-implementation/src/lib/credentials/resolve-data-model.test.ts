// Mock repository
const mockListDataModels = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  listDataModels: (...args: unknown[]) => mockListDataModels(...args),
}));

// Mock services package
const mockGetBridge = jest.fn();
jest.mock('@uncefact/untp-ri-services', () => ({
  getBridge: (...args: unknown[]) => mockGetBridge(...args),
}));

import { resolveDataModel } from './resolve-data-model';
import { ValidationError } from '@/lib/api/validation';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CORE_DATA_MODEL = {
  id: 'dm-1',
  name: 'Digital Product Passport',
  credentialType: 'DigitalProductPassport',
  version: '0.6.1',
  schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.1.json',
  contextUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/context/',
  isExtension: false,
  parentConfig: null,
};

const EXTENSION_DATA_MODEL = {
  id: 'dm-ext-1',
  name: 'AU DPP Extension',
  credentialType: 'DigitalProductPassport',
  version: '0.6.1',
  schemaUrl: 'https://example.com/ext-dpp/0.6.1/schema.json',
  contextUrl: 'https://example.com/ext-dpp/0.6.1/context.jsonld',
  isExtension: true,
  parentConfig: {
    id: 'dm-1',
    credentialType: 'DigitalProductPassport',
    version: '0.6.1',
    schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.1.json',
  },
};

const MOCK_BRIDGE = {
  buildSubject: jest.fn(),
  extractRefs: jest.fn(),
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('resolveDataModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves core data model, bridge, and schema URLs', async () => {
    mockListDataModels.mockResolvedValue({ data: [CORE_DATA_MODEL], total: 1 });
    mockGetBridge.mockReturnValue(MOCK_BRIDGE);

    const result = await resolveDataModel('tenant-1', 'DigitalProductPassport', '0.6.1');

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      credentialType: 'DigitalProductPassport',
      version: '0.6.1',
    });
    expect(mockGetBridge).toHaveBeenCalledWith('DigitalProductPassport', '0.6.1');
    expect(result).toEqual({
      dataModel: CORE_DATA_MODEL,
      bridge: MOCK_BRIDGE,
      schemaUrls: ['https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.1.json'],
      coreDataModelVersion: '0.6.1',
      coreDataModelType: 'DigitalProductPassport',
    });
  });

  it('infers bridge from parent config for extension data models', async () => {
    mockListDataModels.mockResolvedValue({ data: [EXTENSION_DATA_MODEL], total: 1 });
    mockGetBridge.mockReturnValue(MOCK_BRIDGE);

    const result = await resolveDataModel('tenant-1', 'DigitalProductPassport', '0.6.1');

    expect(mockGetBridge).toHaveBeenCalledWith('DigitalProductPassport', '0.6.1');
    expect(result.bridge).toBe(MOCK_BRIDGE);
    expect(result.coreDataModelVersion).toBe('0.6.1');
  });

  it('returns the parent version as coreDataModelVersion when the extension version differs', async () => {
    mockListDataModels.mockResolvedValue({
      data: [
        {
          ...EXTENSION_DATA_MODEL,
          version: '1.2.0',
          parentConfig: { ...EXTENSION_DATA_MODEL.parentConfig, version: '0.6.0' },
        },
      ],
      total: 1,
    });
    mockGetBridge.mockReturnValue(MOCK_BRIDGE);

    const result = await resolveDataModel('tenant-1', 'DigitalLivestockPassport', '1.2.0');

    expect(mockGetBridge).toHaveBeenCalledWith('DigitalProductPassport', '0.6.0');
    expect(result.coreDataModelVersion).toBe('0.6.0');
  });

  it('returns core + extension schema URLs for extension data models', async () => {
    mockListDataModels.mockResolvedValue({ data: [EXTENSION_DATA_MODEL], total: 1 });
    mockGetBridge.mockReturnValue(MOCK_BRIDGE);

    const result = await resolveDataModel('tenant-1', 'DigitalProductPassport', '0.6.1');

    expect(result.schemaUrls).toEqual([
      'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.1.json',
      'https://example.com/ext-dpp/0.6.1/schema.json',
    ]);
  });

  it('throws ValidationError when no data model found', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    await expect(resolveDataModel('tenant-1', 'DigitalProductPassport', '0.6.1')).rejects.toThrow(ValidationError);

    await expect(resolveDataModel('tenant-1', 'DigitalProductPassport', '0.6.1')).rejects.toThrow(
      'No data model found for DigitalProductPassport v0.6.1',
    );
  });

  it('throws ValidationError when no bridge found', async () => {
    mockListDataModels.mockResolvedValue({ data: [CORE_DATA_MODEL], total: 1 });
    mockGetBridge.mockReturnValue(undefined);

    await expect(resolveDataModel('tenant-1', 'DigitalProductPassport', '0.6.1')).rejects.toThrow(ValidationError);

    await expect(resolveDataModel('tenant-1', 'DigitalProductPassport', '0.6.1')).rejects.toThrow(
      'No bridge registered for DigitalProductPassport v0.6.1',
    );
  });
});
