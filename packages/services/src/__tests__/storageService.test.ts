import { publicAPI } from '../utils/httpService';
import { StorageService } from '../storageService';
import type { 
  StorageResponse,
  W3CVerifiableCredential
} from '../interfaces';

jest.mock('../utils/httpService', () => ({
  publicAPI: {
    post: jest.fn(),
    put: jest.fn(),
  },
}));

describe('StorageService', () => {
  let storageService: StorageService;

  beforeEach(() => {
    storageService = new StorageService();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const mockCredential: W3CVerifiableCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential'],
    issuer: 'did:web:example.com',
    credentialSubject: {
      id: 'did:web:subject.example.com',
      name: 'Test Subject',
    },
  } as W3CVerifiableCredential;

  const mockStorageResponse: StorageResponse = {
    uri: 'https://storage.example.com/credentials/test-credential.json',
    hash: 'hash-response',
  };

  describe('store method with POST', () => {
    it('should store credential successfully using POST method', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageResponse);

      const result = await storageService.store(
        'https://api.storage.example.com/upload',
        'POST',
        'test-bucket',
        { verifiableCredential: mockCredential },
      );

      expect(publicAPI.post).toHaveBeenCalledWith(
        'https://api.storage.example.com/upload',
        {
          bucket: 'test-bucket',
          data: { verifiableCredential: mockCredential },
        },
        {
          'Content-Type': 'application/json',
        },
      );
      expect(result).toEqual(mockStorageResponse);
    });

    it('should store credential with custom headers', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageResponse);

      const customHeaders = {
        'X-API-Key': 'test-api-key',
        'X-Custom-Header': 'custom-value',
      };

      const result = await storageService.store(
        'https://api.storage.example.com/upload',
        'POST',
        'test-bucket',
        { verifiableCredential: mockCredential },
        customHeaders,
      );

      expect(publicAPI.post).toHaveBeenCalledWith(
        'https://api.storage.example.com/upload',
        {
          bucket: 'test-bucket',
          data: { verifiableCredential: mockCredential },
        },
        {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'X-Custom-Header': 'custom-value',
        },
      );
      expect(result).toEqual(mockStorageResponse);
    });

    it('should throw error when POST request fails', async () => {
      const errorMessage = 'Network error occurred';
      (publicAPI.post as jest.Mock).mockRejectedValue(new Error(errorMessage));

      await expect(
        storageService.store(
          'https://api.storage.example.com/upload',
          'POST',
          'test-bucket',
          { verifiableCredential: mockCredential },
        ),
      ).rejects.toThrow(`Failed to store verifiable credential: ${errorMessage}`);

      expect(publicAPI.post).toHaveBeenCalled();
    });
  });

  describe('store method with PUT', () => {
    it('should store credential successfully using PUT method', async () => {
      (publicAPI.put as jest.Mock).mockResolvedValue(mockStorageResponse);

      const result = await storageService.store(
        'https://api.storage.example.com/upload',
        'PUT',
        'test-bucket',
        { verifiableCredential: mockCredential },
      );

      expect(publicAPI.put).toHaveBeenCalledWith(
        'https://api.storage.example.com/upload',
        {
          bucket: 'test-bucket',
          data: { verifiableCredential: mockCredential },
        },
        {
          'Content-Type': 'application/json',
        },
      );
      expect(result).toEqual(mockStorageResponse);
    });

    it('should throw error when PUT request fails', async () => {
      const errorMessage = 'Unauthorized access';
      (publicAPI.put as jest.Mock).mockRejectedValue(new Error(errorMessage));

      await expect(
        storageService.store(
          'https://api.storage.example.com/upload',
          'PUT',
          'test-bucket',
          { verifiableCredential: mockCredential },
        ),
      ).rejects.toThrow(`Failed to store verifiable credential: ${errorMessage}`);

      expect(publicAPI.put).toHaveBeenCalled();
    });
  });

  describe('parameter validation', () => {
    it('should throw error when url is empty', async () => {
      await expect(
        storageService.store(
          '',
          'POST',
          'test-bucket',
          { verifiableCredential: mockCredential },
        ),
      ).rejects.toThrow('Error storing VC. API URL is required.');

      expect(publicAPI.post).not.toHaveBeenCalled();
      expect(publicAPI.put).not.toHaveBeenCalled();
    });

    it('should throw error when bucket is empty', async () => {
      await expect(
        storageService.store(
          'https://api.storage.example.com/upload',
          'POST',
          '',
          { verifiableCredential: mockCredential },
        ),
      ).rejects.toThrow('Error storing VC. Bucket name is required.');

      expect(publicAPI.post).not.toHaveBeenCalled();
      expect(publicAPI.put).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle non-Error exceptions', async () => {
      (publicAPI.post as jest.Mock).mockRejectedValue('String error');

      await expect(
        storageService.store(
          'https://api.storage.example.com/upload',
          'POST',
          'test-bucket',
          { verifiableCredential: mockCredential },
        ),
      ).rejects.toThrow('Failed to store verifiable credential: Unknown error');
    });

  describe('headers handling', () => {
    it('should merge custom headers with default Content-Type', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageResponse);

      await storageService.store(
        'https://api.storage.example.com/upload',
        'POST',
        'test-bucket',
        { verifiableCredential: mockCredential },
        { 'X-Request-ID': 'request-123' },
      );

      expect(publicAPI.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        {
          'Content-Type': 'application/json',
          'X-Request-ID': 'request-123',
        },
      );
    });

    it('should handle undefined headers parameter', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageResponse);

      await storageService.store(
        'https://api.storage.example.com/upload',
        'POST',
        'test-bucket',
        { verifiableCredential: mockCredential },
        undefined,
      );

      expect(publicAPI.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        {
          'Content-Type': 'application/json',
        },
      );
    });
  });
});
