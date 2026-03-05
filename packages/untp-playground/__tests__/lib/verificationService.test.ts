import { verifyCredential } from '@/lib/verificationService';

// Mock fetch globally
global.fetch = jest.fn();

describe('verificationService', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('successfully verifies a credential', async () => {
    const mockResponse = { verified: true, results: [] };
    const mockCredential = { id: '123', type: ['VerifiableCredential'] };

    // Mock successful fetch response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await verifyCredential(mockCredential);

    // Verify the result
    expect(result).toEqual(mockResponse);

    // Verify fetch was called with correct parameters
    expect(global.fetch).toHaveBeenCalledWith('https://vckit.untp.showthething.com/agent/routeVerificationCredential', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credential: mockCredential,
        fetchRemoteContexts: true,
        policies: {
          credentialStatus: false,
        },
      }),
    });
  });

  test('uses custom URL and token when provided', async () => {
    const mockResponse = { verified: true, results: [] };
    const mockCredential = { id: '456', type: ['VerifiableCredential'] };
    const customUrl = 'https://custom.example.com/verify';
    const customToken = 'custom-token-123';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await verifyCredential(mockCredential, customUrl, customToken);

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(customUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credential: mockCredential,
        fetchRemoteContexts: true,
        policies: {
          credentialStatus: false,
        },
      }),
    });
  });

  test('falls back to defaults when custom params are undefined', async () => {
    const mockResponse = { verified: true, results: [] };
    const mockCredential = { id: '789', type: ['VerifiableCredential'] };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await verifyCredential(mockCredential, undefined, undefined);

    expect(global.fetch).toHaveBeenCalledWith('https://vckit.untp.showthething.com/agent/routeVerificationCredential', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credential: mockCredential,
        fetchRemoteContexts: true,
        policies: {
          credentialStatus: false,
        },
      }),
    });
  });

  test('handles non-ok response from API', async () => {
    const mockCredential = { id: '123', type: ['VerifiableCredential'] };

    // Mock failed fetch response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    });

    // Verify that the function throws an error
    await expect(verifyCredential(mockCredential)).rejects.toThrow('Verification failed');
  });

  test('handles network error', async () => {
    const mockCredential = { id: '123', type: ['VerifiableCredential'] };
    const networkError = new Error('Network error');

    // Mock network error
    (global.fetch as jest.Mock).mockRejectedValueOnce(networkError);

    // Verify that the function throws the network error
    await expect(verifyCredential(mockCredential)).rejects.toThrow(networkError);
  });

  test('handles JSON parsing error', async () => {
    const mockCredential = { id: '123', type: ['VerifiableCredential'] };
    const jsonError = new Error('Invalid JSON');

    // Mock successful fetch but failed JSON parsing
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw jsonError;
      },
    });

    // Verify that the function throws the JSON parsing error
    await expect(verifyCredential(mockCredential)).rejects.toThrow(jsonError);
  });
});
