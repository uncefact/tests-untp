const loggerCalls = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    child: () => loggerCalls,
  },
}));

const mockDeleteLibraryRecord = jest.fn();
// Only the delete function is replaced; the repository's other runtime
// exports are kept so the module under test sees the real ones.
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  ...jest.requireActual('@/lib/prisma/repositories/library-record.repository'),
  deleteLibraryRecord: (...args: unknown[]) => mockDeleteLibraryRecord(...args),
}));

const mockResolveStorageService = jest.fn();
const mockStorageDelete = jest.fn();
jest.mock('@/lib/services/resolve-storage-service', () => ({
  resolveStorageService: (...args: unknown[]) => mockResolveStorageService(...args),
}));

import { ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { StorageDeleteError } from '@uncefact/untp-ri-services';
import { deleteLibraryRecordAndCopy } from './delete-library-record';

const storageA = {
  storageUri: 'https://storage.example/A',
  storageServiceInstanceId: 'storage-instance-A',
  storageExternalId: 'object-A',
  storageBucket: 'bucket-A',
};
const storageB = {
  storageUri: 'https://storage.example/B',
  storageServiceInstanceId: 'storage-instance-B',
  storageExternalId: 'object-B',
  storageBucket: 'bucket-B',
};

/**
 * The warn and error arguments rendered the way pino renders them: an Error is
 * replaced by its enumerable-looking fields and its cause chain is followed, so
 * a value that reached a message is visible to a `not.toContain` assertion.
 * `JSON.stringify` on the raw arguments cannot see any of that, because
 * `message`, `stack` and `cause` are all non-enumerable.
 */
function renderedLogArguments(): string {
  const render = (value: unknown): unknown => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack, cause: render(value.cause) };
    }
    if (Array.isArray(value)) return value.map(render);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, render(entry)]));
    }
    return value;
  };
  return JSON.stringify(
    render([...loggerCalls.info.mock.calls, ...loggerCalls.warn.mock.calls, ...loggerCalls.error.mock.calls]),
  );
}

function deleteRecord() {
  return deleteLibraryRecordAndCopy({ recordId: 'record-1', tenantId: 'tenant-1' });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteLibraryRecord.mockResolvedValue({ outcome: 'deleted', storage: { ...storageA } });
  mockStorageDelete.mockResolvedValue(undefined);
  mockResolveStorageService.mockResolvedValue({
    service: { delete: mockStorageDelete },
    instanceId: 'storage-instance-1',
  });
});

describe('deleteLibraryRecordAndCopy', () => {
  it.each([
    ['a missing record', { outcome: 'missing' }],
    ['a native record', { outcome: 'native' }],
  ])('returns %s untouched without cleanup', async (_name, result) => {
    mockDeleteLibraryRecord.mockResolvedValue(result);

    await expect(deleteRecord()).resolves.toEqual(result);

    expect(mockDeleteLibraryRecord).toHaveBeenCalledWith({ recordId: 'record-1', tenantId: 'tenant-1' });
    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockStorageDelete).not.toHaveBeenCalled();
  });

  it('uses only the committed custody tuple returned by the writer', async () => {
    mockDeleteLibraryRecord.mockResolvedValue({ outcome: 'deleted', storage: storageB });

    const result = await deleteRecord();

    expect(result).toEqual({ outcome: 'deleted', storage: storageB, cleanup: 'deleted' });
    expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', 'storage-instance-B');
    expect(mockStorageDelete).toHaveBeenCalledWith('object-B', 'bucket-B');
    expect(mockResolveStorageService).not.toHaveBeenCalledWith('tenant-1', 'storage-instance-A');
    expect(mockStorageDelete).not.toHaveBeenCalledWith('object-A', 'bucket-A');
  });

  it('awaits storage cleanup before returning the successful response', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = false;
    mockStorageDelete.mockImplementation(async () => {
      await gate;
      completed = true;
    });

    const resultPromise = deleteRecord();
    let resultSettled = false;
    void resultPromise.then(() => {
      resultSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(resultSettled).toBe(false);

    release();
    const result = await resultPromise;
    expect(completed).toBe(true);
    expect(result).toEqual({ outcome: 'deleted', storage: storageA, cleanup: 'deleted' });
  });

  it.each([
    [
      'resolver',
      'storage_resolution_failed',
      'ServiceInstanceNotFoundError',
      () => mockResolveStorageService.mockRejectedValue(new ServiceInstanceNotFoundError('missing-instance')),
    ],
    [
      'adapter',
      'storage_delete_failed',
      'StorageDeleteError',
      () => mockStorageDelete.mockRejectedValue(new StorageDeleteError(500, 'provider detail')),
    ],
    [
      'adapter 404',
      'storage_delete_failed',
      'StorageDeleteError',
      () => mockStorageDelete.mockRejectedValue(new StorageDeleteError(404, 'provider detail')),
    ],
    [
      // A refused connection reaches this module as fetch's bare TypeError with
      // the code on its cause; the log names both, so an operator can tell
      // "storage unreachable" from a defect (seen live in the exercise).
      'unreachable storage (fetch TypeError with a cause code)',
      'storage_delete_failed',
      'TypeError (ECONNREFUSED)',
      () =>
        mockStorageDelete.mockRejectedValue(
          new TypeError('fetch failed', {
            cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
          }),
        ),
    ],
    [
      'non-Error adapter rejection',
      'storage_delete_failed',
      'string',
      () => mockStorageDelete.mockRejectedValue('provider detail'),
    ],
  ])(
    'reports the deletion and logs all coordinates when %s cleanup fails',
    async (_name, stage, errorName, configure) => {
      configure();

      const result = await deleteRecord();

      expect(result).toEqual({ outcome: 'deleted', storage: storageA, cleanup: stage });
      const logs = renderedLogArguments();
      expect(logs).toContain(stage);
      expect(logs).toContain(`"errorName":"${errorName}"`);
      for (const value of Object.values(storageA)) expect(logs).toContain(value);
      expect(logs).not.toContain('resolver detail');
      expect(logs).not.toContain('provider detail');
      expect(logs).not.toContain('fetch failed');
      expect(logs).not.toContain('connect ECONNREFUSED');
    },
  );

  it('does not call an adapter for a record with no durable copy', async () => {
    const storage = {
      storageUri: null,
      storageServiceInstanceId: null,
      storageExternalId: null,
      storageBucket: null,
    };
    mockDeleteLibraryRecord.mockResolvedValue({ outcome: 'deleted', storage });

    const result = await deleteRecord();

    expect(result).toEqual({ outcome: 'deleted', storage, cleanup: 'no_copy' });
    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockStorageDelete).not.toHaveBeenCalled();
  });

  it.each([
    [
      'partial coordinates',
      {
        storageUri: storageA.storageUri,
        storageServiceInstanceId: null,
        storageExternalId: storageA.storageExternalId,
        storageBucket: storageA.storageBucket,
      },
    ],
    ['empty coordinates', { storageUri: '', storageServiceInstanceId: '', storageExternalId: '', storageBucket: '' }],
  ])('fails closed for %s without guessing a storage target', async (_name, storage) => {
    mockDeleteLibraryRecord.mockResolvedValue({ outcome: 'deleted', storage });

    const result = await deleteRecord();

    expect(result).toEqual({ outcome: 'deleted', storage, cleanup: 'incomplete_storage_coordinates' });
    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockStorageDelete).not.toHaveBeenCalled();
    expect(renderedLogArguments()).toContain('incomplete_storage_coordinates');
  });

  it('deletes a complete storage triple even when storageUri is null', async () => {
    mockDeleteLibraryRecord.mockResolvedValue({
      outcome: 'deleted',
      storage: { ...storageA, storageUri: null },
    });

    const result = await deleteRecord();

    expect(result).toMatchObject({ outcome: 'deleted', cleanup: 'deleted' });
    expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', storageA.storageServiceInstanceId);
    expect(mockStorageDelete).toHaveBeenCalledWith(storageA.storageExternalId, storageA.storageBucket);
  });

  it('records only permitted audit and cleanup fields', async () => {
    const forbidden = {
      sourceUrl: 'https://supplier.example/secret-source',
      decryptionKey: 'secret-decryption-key',
      annotation: 'secret-annotation',
      header: 'secret-header',
    };
    mockDeleteLibraryRecord.mockResolvedValue({
      outcome: 'deleted',
      storage: { ...storageA, ...forbidden },
    } as never);

    await deleteRecord();

    expect(loggerCalls.info).toHaveBeenCalledWith(
      { recordId: 'record-1', tenantId: 'tenant-1', origin: 'external', ...storageA },
      'Library record deleted from database',
    );
    const logged = renderedLogArguments();
    for (const value of Object.values(forbidden)) expect(logged).not.toContain(value);
  });

  it('propagates a repository failure untouched, with no audit or cleanup', async () => {
    const error = new Error('promotion failed');
    mockDeleteLibraryRecord.mockRejectedValue(error);

    await expect(deleteRecord()).rejects.toBe(error);

    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockStorageDelete).not.toHaveBeenCalled();
    expect(loggerCalls.info.mock.calls.some((call) => call[1] === 'Library record deleted from database')).toBe(false);
  });
});
