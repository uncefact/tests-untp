import { decodeJwt } from 'jose';
import { decodeCredential } from './decode-credential.js';
import { VcDecodeError } from '../errors.js';
import type { EnvelopedVerifiableCredential } from '../types.js';

jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));

const mockedDecodeJwt = decodeJwt as jest.MockedFunction<typeof decodeJwt>;

const mockEnvelopedCredential: EnvelopedVerifiableCredential = {
  '@context': ['https://www.w3.org/ns/credentials/v2'] as ['https://www.w3.org/ns/credentials/v2'],
  id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
  type: 'EnvelopedVerifiableCredential' as const,
};

describe('decodeCredential', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should decode valid JWT from enveloped credential', () => {
    const decodedPayload = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
      issuer: { type: ['CredentialIssuer'], id: 'did:web:example.com', name: 'Test Issuer' },
      credentialSubject: { type: ['Product'], id: 'https://example.com/product/1' },
    };

    mockedDecodeJwt.mockReturnValue(decodedPayload as never);

    const result = decodeCredential(mockEnvelopedCredential);

    expect(mockedDecodeJwt).toHaveBeenCalledWith(
      'eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
    );
    expect(result).toEqual(decodedPayload);
  });

  it('should throw VcDecodeError when credential is falsy', () => {
    expect(() => decodeCredential(null as unknown as EnvelopedVerifiableCredential)).toThrow(VcDecodeError);
    expect(() => decodeCredential(null as unknown as EnvelopedVerifiableCredential)).toThrow('Credential is required');
  });

  it('should throw VcDecodeError when type is not EnvelopedVerifiableCredential', () => {
    const credential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'] as ['https://www.w3.org/ns/credentials/v2'],
      id: 'data:application/vc+jwt,some-jwt',
      type: 'SomeOtherType' as const,
    } as unknown as EnvelopedVerifiableCredential;

    expect(() => decodeCredential(credential)).toThrow(VcDecodeError);
    expect(() => decodeCredential(credential)).toThrow('not an EnvelopedVerifiableCredential');
  });

  it('should throw VcDecodeError when encoded data is missing (no comma in id)', () => {
    const credential: EnvelopedVerifiableCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'] as ['https://www.w3.org/ns/credentials/v2'],
      id: 'data:application/vc+jwt',
      type: 'EnvelopedVerifiableCredential' as const,
    };

    expect(() => decodeCredential(credential)).toThrow(VcDecodeError);
    expect(() => decodeCredential(credential)).toThrow('missing encoded data');
  });

  it('should throw VcDecodeError when JWT is malformed', () => {
    mockedDecodeJwt.mockImplementation(() => {
      throw new Error('Invalid JWT format');
    });

    expect(() => decodeCredential(mockEnvelopedCredential)).toThrow(VcDecodeError);
    expect(() => decodeCredential(mockEnvelopedCredential)).toThrow('Invalid JWT format');
  });
});
