jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const mockGetRenderTemplateById = jest.fn();
const mockUpdateRenderTemplateRepo = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  getRenderTemplateById: (...args: unknown[]) => mockGetRenderTemplateById(...args),
  updateRenderTemplate: (...args: unknown[]) => mockUpdateRenderTemplateRepo(...args),
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

import { NotFoundError } from '@/lib/api/errors';
import { updateRenderTemplate } from './update-render-template';
import type { UpdateRenderTemplateInput } from './update-render-template';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_EXISTING = {
  id: 'rt-1',
  tenantId: 'tenant-1',
  name: 'Old Template',
  renderMethodType: 'RenderTemplate2024',
  storageUrl: 'https://storage.example.com/old',
  digestMultibase: 'zTESTold',
  storageExternalId: 'old-ext-id',
  storageBucket: 'old-bucket',
  storageContentType: 'text/html',
  storageServiceInstanceId: 'old-storage-instance',
  isDefault: false,
  inline: false,
  mediaType: 'text/html',
  mediaQuery: null,
  dataModelId: 'dm-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  dataModel: { id: 'dm-1', name: 'DPP' },
};

const MOCK_STORAGE_RESULT = {
  uri: 'https://storage.example.com/new',
  digestMultibase: 'zTESTnew',
  externalId: 'new-ext-id',
  bucket: 'new-bucket',
  mimeType: 'text/html',
};

const mockStoreBinary = jest.fn().mockResolvedValue(MOCK_STORAGE_RESULT);
const mockDelete = jest.fn().mockResolvedValue(undefined);
const mockStorageService = {
  service: { storeBinary: mockStoreBinary, store: jest.fn(), delete: mockDelete },
  instanceId: 'storage-instance-1',
};

const VALIDATED_FIELDS = { inline: false, mediaType: 'text/html', mediaQuery: null };

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildInput(overrides: Partial<UpdateRenderTemplateInput> = {}): UpdateRenderTemplateInput {
  return {
    id: 'rt-1',
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function setupHappyPath() {
  mockGetRenderTemplateById.mockResolvedValue(MOCK_EXISTING);
  mockValidateRenderMethodFields.mockReturnValue(VALIDATED_FIELDS);
  mockUpdateRenderTemplateRepo.mockResolvedValue({ ...MOCK_EXISTING, name: 'Updated' });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('updateRenderTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupHappyPath();
  });

  it('throws NotFoundError when template does not exist', async () => {
    mockGetRenderTemplateById.mockResolvedValue(null);

    await expect(updateRenderTemplate(buildInput())).rejects.toThrow(NotFoundError);
    await expect(updateRenderTemplate(buildInput())).rejects.toThrow('Render template not found');
  });

  it("validates render method fields against existing record's renderMethodType", async () => {
    await updateRenderTemplate(
      buildInput({ inline: true, mediaType: 'application/json', mediaQuery: '(max-width: 600px)' }),
    );

    expect(mockValidateRenderMethodFields).toHaveBeenCalledWith('RenderTemplate2024', {
      inline: true,
      mediaType: 'application/json',
      mediaQuery: '(max-width: 600px)',
    });
  });

  it('uploads new content when template is provided', async () => {
    await updateRenderTemplate(
      buildInput({
        template: '<html>new</html>',
        storageService: mockStorageService as unknown as UpdateRenderTemplateInput['storageService'],
      }),
    );

    expect(mockStoreBinary).toHaveBeenCalledWith('<html>new</html>', 'Old Template', 'text/html', false);
  });

  it('attempts best-effort delete of old content after re-upload', async () => {
    await updateRenderTemplate(
      buildInput({
        template: '<html>new</html>',
        storageService: mockStorageService as unknown as UpdateRenderTemplateInput['storageService'],
      }),
    );

    expect(mockDelete).toHaveBeenCalledWith('old-ext-id', 'old-bucket');
  });

  it('logs warning and continues when delete fails', async () => {
    mockDelete.mockRejectedValue(new Error('Storage unavailable'));

    await expect(
      updateRenderTemplate(
        buildInput({
          template: '<html>new</html>',
          storageService: mockStorageService as unknown as UpdateRenderTemplateInput['storageService'],
        }),
      ),
    ).resolves.not.toThrow();

    expect(mockUpdateRenderTemplateRepo).toHaveBeenCalled();
  });

  it('updates DB record with new storage fields after re-upload', async () => {
    await updateRenderTemplate(
      buildInput({
        template: '<html>new</html>',
        storageService: mockStorageService as unknown as UpdateRenderTemplateInput['storageService'],
      }),
    );

    expect(mockUpdateRenderTemplateRepo).toHaveBeenCalledWith(
      'rt-1',
      'tenant-1',
      expect.objectContaining({
        storageUrl: 'https://storage.example.com/new',
        digestMultibase: 'zTESTnew',
        storageExternalId: 'new-ext-id',
        storageBucket: 'new-bucket',
        storageContentType: 'text/html',
        storageServiceInstanceId: 'storage-instance-1',
      }),
    );
  });

  it('updates metadata fields without re-upload when template is not provided', async () => {
    await updateRenderTemplate(buildInput({ name: 'Renamed Template' }));

    expect(mockStoreBinary).not.toHaveBeenCalled();
    expect(mockUpdateRenderTemplateRepo).toHaveBeenCalledWith(
      'rt-1',
      'tenant-1',
      expect.objectContaining({ name: 'Renamed Template' }),
    );
    // Should NOT contain storage fields
    const repoCallArg = mockUpdateRenderTemplateRepo.mock.calls[0][2];
    expect(repoCallArg).not.toHaveProperty('storageUrl');
    expect(repoCallArg).not.toHaveProperty('storageExternalId');
  });

  it('passes isDefault to repository when provided', async () => {
    await updateRenderTemplate(buildInput({ isDefault: true }));

    expect(mockUpdateRenderTemplateRepo).toHaveBeenCalledWith(
      'rt-1',
      'tenant-1',
      expect.objectContaining({ isDefault: true }),
    );
  });

  it('returns the updated record', async () => {
    const updatedRecord = { ...MOCK_EXISTING, name: 'Updated' };
    mockUpdateRenderTemplateRepo.mockResolvedValue(updatedRecord);

    const result = await updateRenderTemplate(buildInput({ name: 'Updated' }));

    expect(result).toEqual(updatedRecord);
  });

  it('sanitises template content before upload', async () => {
    await updateRenderTemplate(
      buildInput({
        template: '<p>new content</p>',
        storageService: mockStorageService as unknown as UpdateRenderTemplateInput['storageService'],
      }),
    );

    expect(mockSanitiseTemplate).toHaveBeenCalledWith('<p>new content</p>');
  });

  it('skips old content deletion when storageExternalId is null', async () => {
    mockGetRenderTemplateById.mockResolvedValue({
      ...MOCK_EXISTING,
      storageExternalId: null,
    });

    await updateRenderTemplate(
      buildInput({
        template: '<html>new</html>',
        storageService: mockStorageService as unknown as UpdateRenderTemplateInput['storageService'],
      }),
    );

    expect(mockStoreBinary).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
