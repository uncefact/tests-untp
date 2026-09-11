jest.mock('@/lib/api/logger');
const loggerCalls = jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>;

const mockDeleteNativeCredential = jest.fn();
jest.mock('@/lib/prisma/repositories/credential.repository', () => ({
  ...jest.requireActual('@/lib/prisma/repositories/credential.repository'),
  deleteNativeCredential: (...args: unknown[]) => mockDeleteNativeCredential(...args),
}));

const mockResolveStorageService = jest.fn();
const mockStorageDelete = jest.fn();
jest.mock('@/lib/services/resolve-storage-service', () => ({
  resolveStorageService: (...args: unknown[]) => mockResolveStorageService(...args),
}));

import { StorageDeleteError } from '@uncefact/untp-ri-services';
import { deleteNativeCredentialAndCopy } from './delete-native-credential';

const storage = {
  storageUri: 'https://storage.example/A',
  storageServiceInstanceId: 'storage-instance-A',
  storageExternalId: 'object-A',
  storageBucket: 'bucket-A',
};

function deleteCredential() {
  return deleteNativeCredentialAndCopy({ recordId: 'record-1', tenantId: 'tenant-1' });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteNativeCredential.mockResolvedValue({ outcome: 'deleted', storage: { ...storage } });
  mockStorageDelete.mockResolvedValue(undefined);
  mockResolveStorageService.mockResolvedValue({
    service: { delete: mockStorageDelete },
    instanceId: 'storage-instance-A',
  });
});

describe('deleteNativeCredentialAndCopy', () => {
  it.each([
    ['a missing record', { outcome: 'missing' }],
    ['an external record', { outcome: 'external' }],
  ])('returns %s untouched without cleanup', async (_name, result) => {
    mockDeleteNativeCredential.mockResolvedValue(result);

    await expect(deleteCredential()).resolves.toEqual(result);

    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockStorageDelete).not.toHaveBeenCalled();
  });

  it('deletes the copy at the coordinates the row named, on the instance the row named', async () => {
    await expect(deleteCredential()).resolves.toEqual({ outcome: 'deleted', storage, cleanup: 'deleted' });

    expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', 'storage-instance-A');
    expect(mockStorageDelete).toHaveBeenCalledWith('object-A', 'bucket-A');
    expect(loggerCalls.warn).not.toHaveBeenCalled();
  });

  it('leaves a credential issued before coordinates were recorded in place and warns with its URI', async () => {
    mockDeleteNativeCredential.mockResolvedValue({
      outcome: 'deleted',
      storage: { ...storage, storageServiceInstanceId: null, storageExternalId: null, storageBucket: null },
    });

    await expect(deleteCredential()).resolves.toMatchObject({
      outcome: 'deleted',
      cleanup: 'incomplete_storage_coordinates',
    });

    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'record-1',
        storageUri: 'https://storage.example/A',
        stage: 'incomplete_storage_coordinates',
      }),
      'Credential deleted; storage object may be orphaned',
    );
  });

  it('reports a refused storage delete as an orphan without the provider message', async () => {
    mockStorageDelete.mockRejectedValue(new StorageDeleteError(503, 'secret provider text'));

    await expect(deleteCredential()).resolves.toMatchObject({ outcome: 'deleted', cleanup: 'storage_delete_failed' });

    const rendered = JSON.stringify(loggerCalls.warn.mock.calls);
    expect(rendered).toContain('storage_delete_failed');
    expect(rendered).toContain('StorageDeleteError');
    expect(rendered).not.toContain('secret provider text');
  });

  it('propagates a repository failure untouched', async () => {
    const failure = new Error('deadlock detected');
    mockDeleteNativeCredential.mockRejectedValue(failure);

    await expect(deleteCredential()).rejects.toBe(failure);
    expect(mockResolveStorageService).not.toHaveBeenCalled();
  });
});
