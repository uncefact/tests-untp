import { privateAPI } from '../utils';
import { issueCredentialStatus, issueVC } from '../vckit.service';

describe('issueVC', () => {
  it('should issue VC successfully', async () => {
    jest.spyOn(privateAPI, 'post').mockResolvedValue({
      verifiableCredential: {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
      },
    });

    const vc = await issueVC({
      context: ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'Event'],
      issuer: 'did:example:123',
      credentialSubject: { id: 'did:example:123', name: 'John Doe' },
      restOfVC: { render: {} },
      vcKitAPIUrl: 'https://api.vc.example.com',
    });

    expect(vc).toEqual({
      verifiableCredential: {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
      },
    });
  });

  it('should throw error when vcKitAPIUrl is invalid', async () => {
    try {
      await issueVC({
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'Event'],
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        restOfVC: { render: {} },
        vcKitAPIUrl: 'invalid-api-url', // invalid api url
      });
    } catch (error: any) {
      expect(error.message).toEqual('Invalid URL: invalid-api-url');
    }
  });

  it('should throw error when apiKey is invalid', async () => {
    jest.spyOn(privateAPI, 'post').mockRejectedValue(new Error('invalid_argument: apiKey is invalid'));

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
      expect(error.message).toEqual('invalid_argument: apiKey is invalid');
    }
  });

  it('should throw error when type does not include VerifiableCredential', async () => {
    jest.spyOn(privateAPI, 'post').mockRejectedValue(new Error('"type" must include `VerifiableCredential`.'));

    try {
      await issueVC({
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['Event'], // type does not include VerifiableCredential
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        restOfVC: { render: {} },
        vcKitAPIUrl: 'https://api.vc.example.com',
      });
    } catch (error: any) {
      expect(error.message).toEqual('"type" must include `VerifiableCredential`.');
    }
  });
});

describe('issueCredentialStatus', () => {
  it('should issue credential status successfully', async () => {
    jest.spyOn(privateAPI, 'post').mockResolvedValue({
      id: 'http://example.com/bitstring-status-list/25#0',
      statusPurpose: 'revocation',
    });

    const credentialStatus = await issueCredentialStatus({
      host: 'https://api.vc.example.com',
      apiKey: 'test123',
      statusPurpose: 'revocation',
      bitstringStatusIssuer: 'did:example:123',
    });

    expect(credentialStatus).toEqual({
      id: 'http://example.com/bitstring-status-list/25#0',
      statusPurpose: 'revocation',
    });
  });

  it('should throw error when issuer is invalid', async () => {
    jest
      .spyOn(privateAPI, 'post')
      .mockRejectedValue(new Error('invalid_argument: credential.issuer must be a DID managed by this agent.'));

    try {
      await issueCredentialStatus({
        host: 'https://api.vc.example.com',
        apiKey: 'test123',
        statusPurpose: 'revocation',
        bitstringStatusIssuer: 'invalid:issuer:123', // invalid issuer
      });
    } catch (error: any) {
      expect(error.message).toEqual('invalid_argument: credential.issuer must be a DID managed by this agent.');
    }
  });

  it('should throw error when agent is not available', async () => {
    jest.spyOn(privateAPI, 'post').mockRejectedValue(new Error('Agent not available'));

    try {
      await issueCredentialStatus({
        host: 'invalid-api-url', // invalid api url
        apiKey: 'test123',
        statusPurpose: 'revocation',
        bitstringStatusIssuer: 'did:example:123',
      });
    } catch (error: any) {
      expect(error.message).toEqual('Agent not available');
    }
  });
});