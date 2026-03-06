jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const mockGetDataModelById = jest.fn();
const mockCreateRenderTemplateRepo = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  getDataModelById: (...args: unknown[]) => mockGetDataModelById(...args),
  createRenderTemplate: (...args: unknown[]) => mockCreateRenderTemplateRepo(...args),
}));

const mockValidateRenderMethodFields = jest.fn();
jest.mock('./validate-render-method-fields', () => ({
  validateRenderMethodFields: (...args: unknown[]) => mockValidateRenderMethodFields(...args),
}));

const mockSanitiseTemplate = jest.fn((html: string) => html);
jest.mock('./sanitise-template', () => ({
  sanitiseTemplate: (html: string) => mockSanitiseTemplate(html),
}));

jest.mock('@uncefact/untp-ri-services', () => ({}));
jest.mock('@/lib/services/resolve-service', () => ({}));

import { createRenderTemplate } from './create-render-template';
import type { CreateRenderTemplateInput } from './create-render-template';
import { NotFoundError } from '@/lib/api/errors';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const DATA_MODEL_ID = 'dm-1';

const MOCK_DATA_MODEL = {
  id: DATA_MODEL_ID,
  name: 'Digital Product Passport',
  tenantId: TENANT_ID,
};

const MOCK_STORAGE_RESULT = {
  uri: 'https://storage.example.com/doc/123',
  hash: 'sha256-abc',
  externalId: 'ext-id-123',
  bucket: 'pub-bucket',
  mimeType: 'text/html',
};

const mockStoreBinary = jest.fn().mockResolvedValue(MOCK_STORAGE_RESULT);
const mockStorageService = {
  service: { storeBinary: mockStoreBinary, store: jest.fn(), delete: jest.fn() },
  instanceId: 'storage-instance-1',
};

const MOCK_CREATED_RECORD = {
  id: 'rt-1',
  name: 'DPP Template',
  tenantId: TENANT_ID,
  dataModelId: DATA_MODEL_ID,
  renderMethodType: 'RenderTemplate2024',
  storageUrl: MOCK_STORAGE_RESULT.uri,
  hash: MOCK_STORAGE_RESULT.hash,
  isDefault: false,
  dataModel: MOCK_DATA_MODEL,
};

const VALIDATED_FIELDS = {
  inline: false,
  mediaType: 'text/html',
  mediaQuery: null,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildInput(overrides: Partial<CreateRenderTemplateInput> = {}): CreateRenderTemplateInput {
  return {
    tenantId: TENANT_ID,
    name: 'DPP Template',
    dataModelId: DATA_MODEL_ID,
    renderMethodType: 'RenderTemplate2024' as CreateRenderTemplateInput['renderMethodType'],
    template: '<html><body>Hello</body></html>',
    storageService: mockStorageService as unknown as CreateRenderTemplateInput['storageService'],
    ...overrides,
  };
}

function setupHappyPath() {
  mockGetDataModelById.mockResolvedValue(MOCK_DATA_MODEL);
  mockValidateRenderMethodFields.mockReturnValue(VALIDATED_FIELDS);
  mockCreateRenderTemplateRepo.mockResolvedValue(MOCK_CREATED_RECORD);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createRenderTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupHappyPath();
  });

  it('throws NotFoundError when data model does not exist', async () => {
    mockGetDataModelById.mockResolvedValue(null);

    await expect(createRenderTemplate(buildInput())).rejects.toThrow(NotFoundError);
    await expect(createRenderTemplate(buildInput())).rejects.toThrow('Data model not found');
  });

  it('validates render method fields', async () => {
    const input = buildInput({
      inline: true,
      mediaType: 'application/xhtml+xml',
      mediaQuery: 'print',
    });

    await createRenderTemplate(input);

    expect(mockValidateRenderMethodFields).toHaveBeenCalledWith('RenderTemplate2024', {
      inline: true,
      mediaType: 'application/xhtml+xml',
      mediaQuery: 'print',
    });
  });

  it('calls storeBinary with name as filename and text/html content type', async () => {
    const input = buildInput({ name: 'My Template', template: '<p>content</p>' });

    await createRenderTemplate(input);

    expect(mockStoreBinary).toHaveBeenCalledWith('<p>content</p>', 'My Template', 'text/html', false);
  });

  it('creates DB record with storage response uri, hash, externalId, bucket, mimeType, and instanceId', async () => {
    await createRenderTemplate(buildInput());

    expect(mockCreateRenderTemplateRepo).toHaveBeenCalledWith(TENANT_ID, {
      name: 'DPP Template',
      dataModelId: DATA_MODEL_ID,
      renderMethodType: 'RenderTemplate2024',
      storageUrl: MOCK_STORAGE_RESULT.uri,
      hash: MOCK_STORAGE_RESULT.hash,
      isDefault: undefined,
      storageServiceInstanceId: 'storage-instance-1',
      storageExternalId: MOCK_STORAGE_RESULT.externalId,
      storageBucket: MOCK_STORAGE_RESULT.bucket,
      storageContentType: MOCK_STORAGE_RESULT.mimeType,
      ...VALIDATED_FIELDS,
    });
  });

  it('returns the created record', async () => {
    const result = await createRenderTemplate(buildInput());

    expect(result).toEqual(MOCK_CREATED_RECORD);
  });

  it('passes isDefault to repository when provided', async () => {
    await createRenderTemplate(buildInput({ isDefault: true }));

    expect(mockCreateRenderTemplateRepo).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ isDefault: true }));
  });

  it('sanitises template content before upload', async () => {
    const input = buildInput({ template: '<p>content</p>' });
    await createRenderTemplate(input);
    expect(mockSanitiseTemplate).toHaveBeenCalledWith('<p>content</p>');
  });

  it('applies defaults from validation module', async () => {
    const customValidated = { inline: true, mediaType: 'application/xhtml+xml', mediaQuery: 'screen' };
    mockValidateRenderMethodFields.mockReturnValue(customValidated);

    await createRenderTemplate(buildInput());

    expect(mockCreateRenderTemplateRepo).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        inline: true,
        mediaType: 'application/xhtml+xml',
        mediaQuery: 'screen',
      }),
    );
  });
});
