import type {
  CredentialPayload
} from "../interfaces";

import { 
  VerifiableCredentialService 
} from '../verifiableCredential';
import { privateAPI } from '../utils/httpService';

jest.mock('../utils/httpService', () => ({
  privateAPI: {
    post: jest.fn(),
    put: jest.fn(),
    setBearerTokenAuthorizationHeaders: jest.fn(),
  },
}));

describe('verifiableCredential', () => {
  const mockAPIUrl = 'https://api.vc.example.com';
  const mockCredentialSubject = { id: 'did:example:123', name: 'John Doe' };
  const mockIssuer = 'did:example:issuer';

  const mockCredentialStatus = {
    id: 'https://api.vc.example.com/credentials/status/3#94567',
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: '94567',
    statusListCredential: 'https://api.vc.example.com/credentials/status/3'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sign', () => {
    const mockEnvelopedVerifiableCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
      issuer: 'did:web:uncefact.github.io:project-vckit:test-and-development'
    };

    it('should call issue API endpoint with credential status', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      // Mock credential status issuance first, then VC issuance
      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockEnvelopedVerifiableCredential);

      const result = await service.sign(vc);

      // Verify call to credential status endpoint
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        `https://api.vc.example.com/agent/issueBitstringStatusList`,
        expect.objectContaining({
          statusPurpose: 'revocation',
          bitstringStatusIssuer: mockIssuer,
        }),
        { headers: {} },
      );

      // Verify call to issue endpoint with credential status
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: {
            '@context': expect.arrayContaining(['https://www.w3.org/ns/credentials/v2']),
            type: expect.arrayContaining(['VerifiableCredential']),
            issuer: mockIssuer,
            credentialSubject: mockCredentialSubject,
            credentialStatus: mockCredentialStatus,
          }
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockEnvelopedVerifiableCredential);
    });

    it('should pass custom headers to API calls', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const customHeaders = { Authorization: 'Bearer token123' };

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockEnvelopedVerifiableCredential);

      const result = await service.sign(vc, customHeaders);

      // Verify headers in credential status call
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        `https://api.vc.example.com/agent/issueBitstringStatusList`,
        expect.any(Object),
        { headers: customHeaders },
      );

      // Verify headers in issue call
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.any(Object),
        { headers: customHeaders },
      );

      expect(result).toEqual(mockEnvelopedVerifiableCredential);
    });

    it('should fail if credential status issuance fails', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const statusError = new Error('Status issuance failed');

      (privateAPI.post as jest.Mock).mockRejectedValueOnce(statusError);

      await expect(service.sign(vc)).rejects.toThrow('Failed to issue credential status: Status issuance failed');

      expect(privateAPI.post).toHaveBeenCalledTimes(1);
    });

    it('should fail if credential issuance fails', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const issuanceError = new Error('Issuance failed');

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockRejectedValueOnce(issuanceError);

      await expect(service.sign(vc)).rejects.toThrow('Failed to issue verifiable credential: Issuance failed');

      expect(privateAPI.post).toHaveBeenCalledTimes(2);
    });

    it('should issue VC with default context, issuer and type', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockEnvelopedVerifiableCredential);

      const result = await service.sign(vc);

      expect(result).toEqual(mockEnvelopedVerifiableCredential);
    });

    it('should issue VC with added context', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        context: ['https://test.uncefact.org/vocabulary/untp/dia/0.6.0/'],
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockIssueResponse = {
        ...mockEnvelopedVerifiableCredential,
        "@context": ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/']
      };

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc);

      expect(result).toEqual(mockIssueResponse);
    });

    it('should issue VC with added type', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        type: ['Custom Type'],
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockIssueResponse = {
        ...mockEnvelopedVerifiableCredential,
        type: ['Custom Type', 'VerifiableCredential']
      };

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc);

      expect(result).toEqual(mockIssueResponse);
    });

    it('should use provided credential status instead of issuing new one', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const customCredentialStatus = {
        id: 'https://custom.example.com/status/1#123',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'suspension',
        statusListIndex: '123',
        statusListCredential: 'https://custom.example.com/status/1'
      };

      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject,
        credentialStatus: customCredentialStatus
      } as CredentialPayload;

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockEnvelopedVerifiableCredential);

      const result = await service.sign(vc);

      // Verify credential status endpoint was NOT called
      expect(privateAPI.post).toHaveBeenCalledTimes(1);

      // Verify only issue endpoint was called with the provided credential status
      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: expect.objectContaining({
            credentialStatus: customCredentialStatus,
          })
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockEnvelopedVerifiableCredential);
    });

    it('should throw error when baseURL is not provided', () => {
      expect(() => new VerifiableCredentialService('')).toThrow('Error creating VerifiableCredentialService. API URL is required.');
    });

    it('should throw error when vc.credentialSubject is not provided', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: {}
      } as CredentialPayload;

      await expect(service.sign(vc)).rejects.toThrow('Error issuing VC. credentialSubject is required in credential payload.');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should throw error when headers have invalid format', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const invalidHeaders = { Authorization: 123 } as any;

      await expect(service.sign(vc, invalidHeaders)).rejects.toThrow('Headers must be a plain object with string values');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

  });
})
