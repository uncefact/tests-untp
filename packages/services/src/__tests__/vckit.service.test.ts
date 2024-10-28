import { issueVC, issueCredentialStatus } from '../vckit.service';
import { privateAPI } from '../utils/httpService';
import { decodeJwt } from 'jose';
import appConfig from '../../../mock-app/src/constants/app-config.json';
import { decodeEnvelopedVC, verifyVC } from '../vckit.service';

jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));

jest.mock('../utils/httpService', () => ({
  privateAPI: {
    post: jest.fn(),
    put: jest.fn(),
    setBearerTokenAuthorizationHeaders: jest.fn(),
  },
}));

describe('vckit.service', () => {
  const mockVcKitAPIUrl = 'https://api.vc.example.com';
  const mockCredentialSubject = { id: 'did:example:123', name: 'John Doe' };
  const mockIssuer = 'did:example:issuer';
  const mockCredentialStatus = {
    id: 'http://example.com/bitstring-status-list/1#0',
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: 0,
    statusListCredential: 'http://example.com/bitstring-status-list/1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('issueVC', () => {
    const defaultParams = {
      credentialSubject: mockCredentialSubject,
      issuer: mockIssuer,
      vcKitAPIUrl: mockVcKitAPIUrl,
    };

    const mockVerifiableCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
    };

    it('should issue VC with default context and type', async () => {
      const mockResponse = { verifiableCredential: mockVerifiableCredential };
      (privateAPI.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await issueVC(defaultParams);

      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockVcKitAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: expect.objectContaining({
            '@context': expect.arrayContaining([
              'https://www.w3.org/ns/credentials/v2',
              'https://www.w3.org/ns/credentials/examples/v2',
              'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
            ]),
            type: ['VerifiableCredential'],
            issuer: mockIssuer,
            credentialSubject: mockCredentialSubject,
          }),
          options: { proofFormat: 'EnvelopingProofJose' },
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockVerifiableCredential);
    });

    it('should issue VC successfully when credential status is provided', async () => {
      const mockResponse = { verifiableCredential: mockVerifiableCredential };
      (privateAPI.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await issueVC({
        ...defaultParams,
        credentialStatus: mockCredentialStatus,
        type: ['Event'],
      });

      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockVcKitAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: expect.objectContaining({
            credentialStatus: mockCredentialStatus,
          }),
        }),
        { headers: {} },
      );
      expect(result).toEqual(mockVerifiableCredential);
    });

    it('should issue VC successfully when credential status is not provided', async () => {
      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce({ verifiableCredential: mockVerifiableCredential });

      const result = await issueVC({
        ...defaultParams,
        type: ['Event'],
      });

      expect(privateAPI.post).toHaveBeenCalledTimes(2);
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        `${mockVcKitAPIUrl}/agent/issueBitstringStatusList`,
        {
          bitstringStatusIssuer: mockIssuer,
          statusPurpose: 'revocation',
        },
        { headers: {} },
      );
      expect(result).toEqual(mockVerifiableCredential);
    });

    it('should include custom context and type if provided', async () => {
      const customParams = {
        ...defaultParams,
        context: ['https://custom-context.example.com'],
        type: ['CustomCredential'],
      };

      const mockResponse = { verifiableCredential: mockVerifiableCredential };
      (privateAPI.post as jest.Mock).mockResolvedValue(mockResponse);

      await issueVC(customParams);

      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockVcKitAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: expect.objectContaining({
            '@context': expect.arrayContaining([
              'https://www.w3.org/ns/credentials/v2',
              'https://www.w3.org/ns/credentials/examples/v2',
              'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
              'https://custom-context.example.com',
            ]),
            type: ['VerifiableCredential', 'CustomCredential'],
          }),
        }),
        { headers: {} },
      );
    });

    it('should include custom headers if provided', async () => {
      const customHeaders = { 'X-Custom-Header': 'CustomValue' };
      const mockResponse = { verifiableCredential: mockVerifiableCredential };
      (privateAPI.post as jest.Mock).mockResolvedValue(mockResponse);

      await issueVC({
        ...defaultParams,
        headers: customHeaders,
      });

      expect(privateAPI.post).toHaveBeenCalledWith(expect.any(String), expect.any(Object), { headers: customHeaders });
    });

    it('should throw error when headers are not a plain object with string values', async () => {
      const invalidHeaders = { invalidHeader: 123 };

      await expect(
        issueVC({
          ...defaultParams,
          headers: invalidHeaders as any,
        }),
      ).rejects.toThrow('VcKit headers defined in app config must be a plain object with string values');
    });

    it('should include additional properties in restOfVC', async () => {
      const mockResponse = { verifiableCredential: mockVerifiableCredential };
      (privateAPI.post as jest.Mock).mockResolvedValue(mockResponse);

      await issueVC({
        ...defaultParams,
        restOfVC: {
          expirationDate: '2023-12-31T23:59:59Z',
        },
      });

      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockVcKitAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: expect.objectContaining({
            expirationDate: '2023-12-31T23:59:59Z',
          }),
        }),
        { headers: {} },
      );
    });
  });

  describe('issueCredentialStatus', () => {
    const defaultStatusParams = {
      host: mockVcKitAPIUrl,
      apiKey: 'test123',
      statusPurpose: 'revocation',
      bitstringStatusIssuer: mockIssuer,
    };

    it('should issue credential status successfully', async () => {
      const mockResponse = {
        id: 'http://example.com/bitstring-status-list/25#0',
        statusPurpose: 'revocation',
      };
      (privateAPI.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await issueCredentialStatus(defaultStatusParams);

      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockVcKitAPIUrl}/agent/issueBitstringStatusList`,
        {
          bitstringStatusIssuer: mockIssuer,
          statusPurpose: 'revocation',
          apiKey: 'test123',
        },
        { headers: {} },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when missing required host parameter', async () => {
      await expect(
        issueCredentialStatus({
          ...defaultStatusParams,
          host: '',
        }),
      ).rejects.toThrow('Error issuing credential status: Host is required');

      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should throw error when missing required bitstringStatusIssuer parameter', async () => {
      await expect(
        issueCredentialStatus({
          ...defaultStatusParams,
          bitstringStatusIssuer: '',
        }),
      ).rejects.toThrow('Error issuing credential status: Bitstring Status Issuer is required');

      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should throw error when issuer is invalid', async () => {
      (privateAPI.post as jest.Mock).mockRejectedValue(
        new Error('invalid_argument: credential.issuer must be a DID managed by this agent.'),
      );

      await expect(
        issueCredentialStatus({
          ...defaultStatusParams,
          bitstringStatusIssuer: 'invalid:issuer:123',
        }),
      ).rejects.toThrow('invalid_argument: credential.issuer must be a DID managed by this agent.');
    });

    it('should handle custom headers', async () => {
      const customHeaders = { 'X-Custom-Header': 'CustomValue' };
      const mockResponse = {
        id: 'http://example.com/bitstring-status-list/25#0',
        statusPurpose: 'revocation',
      };
      (privateAPI.post as jest.Mock).mockResolvedValue(mockResponse);

      await issueCredentialStatus({
        ...defaultStatusParams,
        headers: customHeaders,
      });

      expect(privateAPI.post).toHaveBeenCalledWith(expect.any(String), expect.any(Object), { headers: customHeaders });
    });

    it('should throw error when headers are not a plain object with string values', async () => {
      const invalidArrayHeaders = ['invalid-header'];
      const invalidValueHeaders = { 'invalid-header': 123 };

      await expect(
        issueCredentialStatus({
          ...defaultStatusParams,
          headers: invalidArrayHeaders as any,
        }),
      ).rejects.toThrow('VcKit headers defined in app config must be a plain object with string values');

      await expect(
        issueCredentialStatus({
          ...defaultStatusParams,
          headers: invalidValueHeaders as any,
        }),
      ).rejects.toThrow('VcKit headers defined in app config must be a plain object with string values');

      expect(privateAPI.post).not.toHaveBeenCalled();
    });
  });

  describe('verifyVC', () => {
    afterEach(() => {
      jest.resetAllMocks();
    });

    it('should throw error when vcKitAPIUrl is not provided', async () => {
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: {
          id: 'did:web:localhost',
          name: 'John Doe',
          age: 30,
        },
      } as any;

      await expect(verifyVC(vc)).rejects.toThrow('Error verifying VC. VcKit API URL is required.');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should call privateAPI.post with the correct arguments when vcKitAPIUrl is provided', async () => {
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: {
          id: 'did:web:localhost',
          name: 'John Doe',
          age: 30,
        },
      } as any;

      const vckitAPIUrl = 'https://example.vcservice.com/credentials/verify';

      await verifyVC(vc, vckitAPIUrl);

      expect(privateAPI.post).toHaveBeenCalledWith(
        vckitAPIUrl,
        {
          credential: vc,
          fetchRemoteContexts: true,
          policies: {
            credentialStatus: true,
          },
        },
        { headers: {} },
      );
    });

    it('should handle custom headers', async () => {
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: { id: 'did:web:localhost' },
      } as any;

      const customHeaders = { 'X-Custom-Header': 'CustomValue' };
      const vckitAPIUrl = 'https://example.vcservice.com/credentials/verify';

      await verifyVC(vc, vckitAPIUrl, customHeaders);

      expect(privateAPI.post).toHaveBeenCalledWith(vckitAPIUrl, expect.any(Object), { headers: customHeaders });
    });

    it('should throw error when headers are not a plain object with string values', async () => {
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: { id: 'did:web:localhost' },
      } as any;

      const invalidHeaders = { invalidHeader: 123 };
      const vckitAPIUrl = 'https://example.vcservice.com/credentials/verify';

      await expect(verifyVC(vc, vckitAPIUrl, invalidHeaders as any)).rejects.toThrow(
        'VcKit headers defined in app config must be a plain object with string values',
      );
    });
  });

  describe('decodeEnvelopedVC', () => {
    afterEach(() => {
      jest.resetAllMocks();
    });

    it('should return null when vc is not enveloped', () => {
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: {
          id: 'did:web:localhost',
          name: 'John Doe',
          age: 30,
        },
      } as any;

      const result = decodeEnvelopedVC(vc);

      expect(result).toBeNull();
    });

    it('should return the decoded vc when vc is enveloped', () => {
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc-ld+jwt,jwt.abc.123',
      } as any;

      (decodeJwt as jest.Mock).mockReturnValue({
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: {
          id: 'did:web:localhost',
          name: 'John Doe',
          age: 30,
        },
      });

      const result = decodeEnvelopedVC(vc);
      expect(result).not.toBeNull();
    });
  });
});
