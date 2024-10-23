import { privateAPI } from '../utils';
import  { issueCredentialStatus, issueVC }  from '../vckit.service';

describe('issueVC', () => {
  const mockCredentialStatus = {
    'id': 'http://example.com/bitstring-status-list/1#0',
    'type': 'BitstringStatusListEntry',
    'statusPurpose': 'revocation',
    'statusListIndex': 0,
    'statusListCredential': 'http://example.com/bitstring-status-list/1'
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should issue VC successfully when credential status is provided in the issue VC payload', async () => {
    jest.spyOn(privateAPI, 'post')
      .mockResolvedValueOnce({
        verifiableCredential: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          type: 'EnvelopedVerifiableCredential',
          id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
        },
      });

    const vc = await issueVC({
      context: ['https://www.w3.org/ns/credentials/v2'],
      type: ['Event'],
      issuer: 'did:example:123',
      credentialStatus: mockCredentialStatus,
      credentialSubject: { id: 'did:example:123', name: 'John Doe' },
      restOfVC: { render: {} },
      vcKitAPIUrl: 'https://api.vc.example.com',
    });

    expect(privateAPI.post).toHaveBeenCalledTimes(1);
    expect(privateAPI.post).toHaveBeenCalledWith('https://api.vc.example.com/credentials/issue', {
      credential: {
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://www.w3.org/ns/credentials/examples/v2',
          'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
          'https://www.w3.org/ns/credentials/v2'
        ],
        type: [ 'VerifiableCredential', 'Event' ],
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        credentialStatus: {
          id: 'http://example.com/bitstring-status-list/1#0',
          type: 'BitstringStatusListEntry',
          statusPurpose: 'revocation',
          statusListIndex: 0,
          statusListCredential: 'http://example.com/bitstring-status-list/1'
        },
        render: {}
      },
      options: { proofFormat: 'EnvelopingProofJose' }
    });
    expect(vc).toEqual({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
    });
  });

  it('should issue VC successfully when credential status is not provided in the issue VC payload', async () => {
    jest.spyOn(privateAPI, 'post')
      .mockResolvedValueOnce(mockCredentialStatus)
      .mockResolvedValueOnce({
        verifiableCredential: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          type: 'EnvelopedVerifiableCredential',
          id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
        },
      });

    const vc = await issueVC({
      context: ['https://www.w3.org/ns/credentials/v2'],
      type: ['Event'],
      issuer: 'did:example:123',
      credentialSubject: { id: 'did:example:123', name: 'John Doe' },
      restOfVC: { render: {} },
      vcKitAPIUrl: 'https://api.vc.example.com',
    });

    expect(privateAPI.post).toHaveBeenCalledTimes(2);
    expect(privateAPI.post).toHaveBeenNthCalledWith(1, 'https://api.vc.example.com/agent/issueBitstringStatusList', {
      bitstringStatusIssuer: 'did:example:123',
      statusPurpose: 'revocation',
    });
    expect(privateAPI.post).toHaveBeenLastCalledWith('https://api.vc.example.com/credentials/issue', {
      credential: {
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://www.w3.org/ns/credentials/examples/v2',
          'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
          'https://www.w3.org/ns/credentials/v2'
        ],
        type: [ 'VerifiableCredential', 'Event' ],
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        credentialStatus: {
          id: 'http://example.com/bitstring-status-list/1#0',
          type: 'BitstringStatusListEntry',
          statusPurpose: 'revocation',
          statusListIndex: 0,
          statusListCredential: 'http://example.com/bitstring-status-list/1'
        },
        render: {}
      },
      options: { proofFormat: 'EnvelopingProofJose' }
    });
    expect(vc).toEqual({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
    });
  });

  it('should throw error when issue credential status fails', async () => {
    jest.spyOn(privateAPI, 'post').mockRejectedValueOnce(new Error('Agent not available'));

    try {
      await issueVC({
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'Event'],
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        restOfVC: { render: {} },
        vcKitAPIUrl: 'https://api.vc.example.com',
      });
    } catch (error: any) {
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
      expect(privateAPI.post).toHaveBeenNthCalledWith(1, 'https://api.vc.example.com/agent/issueBitstringStatusList', {
        bitstringStatusIssuer: 'did:example:123',
        statusPurpose: 'revocation',
      });
      expect(error.message).toEqual('Agent not available');
    }
  });

  it('should throw error when vcKitAPIUrl is invalid', async () => {
    jest.spyOn(privateAPI, 'post')
      .mockResolvedValueOnce(mockCredentialStatus)
      .mockResolvedValueOnce(new Error('Invalid URL: invalid-api-url'));

    try {
      await issueVC({
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'Event'],
        issuer: 'did:example:123',
        credentialStatus: mockCredentialStatus,
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        restOfVC: { render: {} },
        vcKitAPIUrl: 'invalid-api-url', // invalid api url
      });
    } catch (error: any) {
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
      expect(privateAPI.post).toHaveBeenNthCalledWith(1, 'https://api.vc.example.com/agent/issueBitstringStatusList', {
        credential: {
          '@context': [
            'https://www.w3.org/ns/credentials/v2',
            'https://www.w3.org/ns/credentials/examples/v2',
            'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
            'https://www.w3.org/ns/credentials/v2'
          ],
          type: [ 'VerifiableCredential', 'Event' ],
          issuer: 'did:example:123',
          credentialSubject: { id: 'did:example:123', name: 'John Doe' },
          credentialStatus: {
            id: 'http://example.com/bitstring-status-list/1#0',
            type: 'BitstringStatusListEntry',
            statusPurpose: 'revocation',
            statusListIndex: 0,
            statusListCredential: 'http://example.com/bitstring-status-list/1'
          },
          render: {}
        },
        options: { proofFormat: 'EnvelopingProofJose' }
      });
      expect(error.message).toEqual('Invalid URL: invalid-api-url');
    }
  });

  it('should throw error when apiKey is invalid', async () => {
    privateAPI.setBearerTokenAuthorizationHeaders('invalid-api'); // invalid api key
    jest.spyOn(privateAPI, 'post').mockRejectedValueOnce(new Error('invalid_argument: apiKey is invalid'));

    try {
      await issueVC({
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['Event'],
        issuer: 'did:example:123',
        credentialStatus: mockCredentialStatus,
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        restOfVC: { render: {} },
        vcKitAPIUrl: 'https://api.vc.example.com',
      });
    } catch (error: any) {
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
      expect(privateAPI.post).toHaveBeenNthCalledWith(1, 'https://api.vc.example.com/credentials/issue', {
        credential: {
          '@context': [
            'https://www.w3.org/ns/credentials/v2',
            'https://www.w3.org/ns/credentials/examples/v2',
            'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
            'https://www.w3.org/ns/credentials/v2'
          ],
          type: [ 'VerifiableCredential', 'Event' ],
          issuer: 'did:example:123',
          credentialSubject: { id: 'did:example:123', name: 'John Doe' },
          credentialStatus: {
            id: 'http://example.com/bitstring-status-list/1#0',
            type: 'BitstringStatusListEntry',
            statusPurpose: 'revocation',
            statusListIndex: 0,
            statusListCredential: 'http://example.com/bitstring-status-list/1'
          },
          render: {}
        },
        options: { proofFormat: 'EnvelopingProofJose' }
      });
      expect(error.message).toEqual('invalid_argument: apiKey is invalid');
    }
  });

  it('should throw error when type does not include VerifiableCredential', async () => {
    jest.spyOn(privateAPI, 'post').mockRejectedValueOnce(new Error('"type" must include `VerifiableCredential`.'));

    try {
      await issueVC({
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['Event'], // type does not include VerifiableCredential
        issuer: 'did:example:123',
        credentialStatus: mockCredentialStatus,
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        restOfVC: { render: {} },
        vcKitAPIUrl: 'https://api.vc.example.com',
      });
    } catch (error: any) {
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
      expect(privateAPI.post).toHaveBeenNthCalledWith(1, 'https://api.vc.example.com/credentials/issue', {
        credential: {
          '@context': [
            'https://www.w3.org/ns/credentials/v2',
            'https://www.w3.org/ns/credentials/examples/v2',
            'https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dev-render-method-context.json',
            'https://www.w3.org/ns/credentials/v2'
          ],
          type: [ 'VerifiableCredential', 'Event' ],
          issuer: 'did:example:123',
          credentialSubject: { id: 'did:example:123', name: 'John Doe' },
          credentialStatus: {
            id: 'http://example.com/bitstring-status-list/1#0',
            type: 'BitstringStatusListEntry',
            statusPurpose: 'revocation',
            statusListIndex: 0,
            statusListCredential: 'http://example.com/bitstring-status-list/1'
          },
          render: {}
        },
        options: { proofFormat: 'EnvelopingProofJose' }
      });
      expect(error.message).toEqual(`"type" must include \`VerifiableCredential\`.`);
    }
  });
});

describe('issueCredentialStatus', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should issue credential status successfully', async () => {
    jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({
      id: 'http://example.com/bitstring-status-list/25#0',
      statusPurpose: 'revocation',
    });

    const credentialStatus = await issueCredentialStatus({
      host: 'https://api.vc.example.com',
      apiKey: 'test123',
      statusPurpose: 'revocation',
      bitstringStatusIssuer: 'did:example:123',
    });

    expect(privateAPI.post).toHaveBeenCalledTimes(1);
    expect(privateAPI.post).toHaveBeenCalledWith('https://api.vc.example.com/agent/issueBitstringStatusList', {
      bitstringStatusIssuer: 'did:example:123',
      statusPurpose: 'revocation',
    });
    expect(credentialStatus).toEqual({
      id: 'http://example.com/bitstring-status-list/25#0',
      statusPurpose: 'revocation',
    });
  });

  it('should throw error when missing required host parameter', async () => {
    jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({});

    try {
      await issueCredentialStatus({
        host: '', // missing host
        apiKey: 'test123',
        statusPurpose: 'revocation',
        bitstringStatusIssuer: 'did:example:123',
      });
    } catch (error: any) {
      expect(privateAPI.post).not.toHaveBeenCalled();
      expect(error.message).toEqual('Error issuing credential status: Host is required');
    }
  });

  it('should throw error when missing required apiKey parameter', async () => {
    jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({});

    try {
      await issueCredentialStatus({
        host: 'https://api.vc.example.com',
        apiKey: '', // missing apiKey
        statusPurpose: 'revocation',
        bitstringStatusIssuer: 'did:example:123',
      });
    } catch (error: any) {
      expect(privateAPI.post).not.toHaveBeenCalled();
      expect(error.message).toEqual('Error issuing credential status: API Key is required');
    }
  });

  it('should throw error when missing required bitstringStatusIssuer parameter', async () => {
    jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({});

    try {
      await issueCredentialStatus({
        host: 'https://api.vc.example.com',
        apiKey: 'test123',
        statusPurpose: 'revocation',
        bitstringStatusIssuer: '', // missing bitstringStatusIssuer
      });
    } catch (error: any) {
      expect(privateAPI.post).not.toHaveBeenCalled();
      expect(error.message).toEqual('Error issuing credential status: Bitstring Status Issuer is required');
    }
  });

  it('should throw error when issuer is invalid', async () => {
    jest
      .spyOn(privateAPI, 'post')
      .mockRejectedValueOnce(new Error('invalid_argument: credential.issuer must be a DID managed by this agent.'));

    try {
      await issueCredentialStatus({
        host: 'https://api.vc.example.com',
        apiKey: 'test123',
        statusPurpose: 'revocation',
        bitstringStatusIssuer: 'invalid:issuer:123', // invalid issuer
      });
    } catch (error: any) {
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
      expect(privateAPI.post).toHaveBeenCalledWith('https://api.vc.example.com/agent/issueBitstringStatusList', {
        bitstringStatusIssuer: 'invalid:issuer:123',
        statusPurpose: 'revocation',
      });
      expect(error.message).toEqual('invalid_argument: credential.issuer must be a DID managed by this agent.');
    }
  });

  it('should throw error when agent is not available', async () => {
    jest.spyOn(privateAPI, 'post').mockRejectedValueOnce(new Error('Agent not available'));

    try {
      await issueCredentialStatus({
        host: 'invalid-api-url', // invalid api url
        apiKey: 'test123',
        statusPurpose: 'revocation',
        bitstringStatusIssuer: 'did:example:123',
      });
    } catch (error: any) {
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
      expect(privateAPI.post).toHaveBeenCalledWith('invalid-api-url/agent/issueBitstringStatusList', {
        bitstringStatusIssuer: 'did:example:123',
        statusPurpose: 'revocation',
      });
      expect(error.message).toEqual('Agent not available');
    }
  });

  it('should throw error when apiKey is invalid', async () => {
    privateAPI.setBearerTokenAuthorizationHeaders('invalid-api'); // invalid api key
    jest.spyOn(privateAPI, 'post').mockRejectedValueOnce(new Error('invalid_argument: apiKey is invalid'));

    try {
      await issueCredentialStatus({
        host: 'https://api.vc.example.com',
        apiKey: 'test123',
        statusPurpose: 'revocation',
        bitstringStatusIssuer: 'did:example:123',
      });
    } catch (error: any) {
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
      expect(privateAPI.post).toHaveBeenCalledWith('https://api.vc.example.com/agent/issueBitstringStatusList', {
        bitstringStatusIssuer: 'did:example:123',
        statusPurpose: 'revocation',
      });
      expect(error.message).toEqual('invalid_argument: apiKey is invalid');
    }
  });
});