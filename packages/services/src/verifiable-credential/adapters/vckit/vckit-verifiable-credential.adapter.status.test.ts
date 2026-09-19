jest.mock('jose', () => ({
  decodeJwt: (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')),
}));

import { VCKitVerifiableCredentialService } from './vckit-verifiable-credential.adapter';
import { httpFetch } from '../../../http/client';
import type { LoggerService } from '../../../logging/types';
import type { VCKitVerifiableCredentialConfig } from './vckit-verifiable-credential.schema';
import type { CredentialPayload, CredentialStatusEntry, SignOptions } from '../../types';
import {
  VcCredentialStatusError,
  VcSignError,
  VcStatusEntryUnsupportedError,
  VcStatusListNotFoundError,
  VcStatusReadError,
  VcStatusResponseInvalidError,
  VcStatusSetError,
} from '../../errors';

jest.mock('../../../http/client.js', () => ({ httpFetch: jest.fn() }));

const mockedHttpFetch = jest.mocked(httpFetch);
const mockWarn = jest.fn();

const mockLogger: LoggerService = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: mockWarn,
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

const mockConfig: VCKitVerifiableCredentialConfig = {
  baseUrl: 'https://vckit.example.com/instance',
  apiKey: 'test-api-key',
  apiVersion: '1.0.0',
};

const payload: CredentialPayload = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential'],
  issuer: {
    type: ['CredentialIssuer'],
    id: 'did:web:issuer.example',
    name: 'Issuer',
  },
  credentialSubject: { type: ['Product'], id: 'urn:product:1' },
};

const entry = (overrides: Partial<CredentialStatusEntry> = {}): CredentialStatusEntry => ({
  id: 'https://vckit.example.com/status/1#42',
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListIndex: '42',
  statusListCredential: 'https://vckit.example.com/status/1',
  ...overrides,
});

const response = (body: unknown, status = 200, statusText = 'OK'): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Response;

const defaultSignal = new AbortController().signal;

describe('VCKit status contract', () => {
  beforeEach(() => {
    mockedHttpFetch.mockReset();
    mockWarn.mockClear();
  });

  it('mints ordered entries, then dispatches exactly once before the issue request', async () => {
    // Catches a regression that dispatches before status minting, dispatches more than once, or emits a string index in the signed credential.
    const providerMinted = [
      {
        ...entry(),
        statusPurpose: 'revocation',
        statusListIndex: 7,
        statusListCredential: 'http://localhost:3332/credentials/status/bitstring-status-list/1',
        id: 'http://localhost:3332/credentials/status/bitstring-status-list/1#7',
      } as unknown as Record<string, unknown>,
      {
        ...entry(),
        statusPurpose: 'suspension',
        statusListIndex: 8,
        statusListCredential: 'http://localhost:3332/credentials/status/bitstring-status-list/2',
        id: 'http://localhost:3332/credentials/status/bitstring-status-list/2#8',
      } as unknown as Record<string, unknown>,
    ];
    const requestEvents: string[] = [];
    const providerResponses = [
      response(providerMinted[0]),
      response(providerMinted[1]),
      response({
        verifiableCredential: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          id: 'signed',
          type: 'EnvelopedVerifiableCredential',
        },
      }),
    ];
    mockedHttpFetch.mockImplementation(async (input) => {
      requestEvents.push(String(input).endsWith('/issue') ? 'issue' : 'mint');
      return providerResponses.shift() as Response;
    });
    const serialiseMock = jest.fn(
      (key: string, fn: () => Promise<CredentialStatusEntry>, signal?: AbortSignal): Promise<CredentialStatusEntry> => {
        expect(key).toBe('status-list:https://vckit.example.com:did:web:issuer.example');
        expect(signal).toBeUndefined();
        return fn();
      },
    );
    const serialise = serialiseMock as NonNullable<SignOptions['serialise']>;
    const onDispatch = jest.fn(() => requestEvents.push('dispatch'));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await adapter.sign(payload, { statusPurposes: ['revocation', 'suspension'], serialise, onDispatch });

    expect(requestEvents).toEqual(['mint', 'mint', 'dispatch', 'issue']);
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(serialiseMock).toHaveBeenCalledTimes(2);
    expect(serialiseMock.mock.calls[0][0]).toBe('status-list:https://vckit.example.com:did:web:issuer.example');
    expect(JSON.parse(mockedHttpFetch.mock.calls[0][1]?.body as string)).toEqual({
      statusPurpose: 'revocation',
      bitstringStatusIssuer: 'did:web:issuer.example',
    });
    expect(JSON.parse(mockedHttpFetch.mock.calls[1][1]?.body as string)).toEqual({
      statusPurpose: 'suspension',
      bitstringStatusIssuer: 'did:web:issuer.example',
    });
    expect(JSON.parse(mockedHttpFetch.mock.calls[2][1]?.body as string).credential.credentialStatus).toEqual(
      providerMinted,
    );
  });

  it('uses a stable key for one issuer and a different key for another issuer at the same origin', async () => {
    // Catches a regression that keys only by origin and serialises unrelated issuers together.
    mockedHttpFetch
      .mockResolvedValueOnce(response(entry({ statusListIndex: '1' })))
      .mockResolvedValueOnce(
        response({
          verifiableCredential: {
            '@context': ['https://www.w3.org/ns/credentials/v2'],
            id: 'signed-one',
            type: 'EnvelopedVerifiableCredential',
          },
        }),
      )
      .mockResolvedValueOnce(response(entry({ statusListIndex: '2' })))
      .mockResolvedValueOnce(
        response({
          verifiableCredential: {
            '@context': ['https://www.w3.org/ns/credentials/v2'],
            id: 'signed-two',
            type: 'EnvelopedVerifiableCredential',
          },
        }),
      );
    const keys: string[] = [];
    const serialise = async (key: string, fn: () => Promise<CredentialStatusEntry>) => {
      keys.push(key);
      return fn();
    };
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await adapter.sign(payload, { serialise });
    await adapter.sign(
      { ...payload, issuer: { ...payload.issuer, id: 'did:web:other-issuer.example' } },
      { serialise },
    );

    expect(keys).toEqual([
      'status-list:https://vckit.example.com:did:web:issuer.example',
      'status-list:https://vckit.example.com:did:web:other-issuer.example',
    ]);
  });

  it('accepts a non-empty string context in the issue response', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response(entry())).mockResolvedValueOnce(
      response({
        verifiableCredential: {
          '@context': 'https://www.w3.org/ns/credentials/v2',
          id: 'signed',
          type: 'EnvelopedVerifiableCredential',
        },
      }),
    );
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(adapter.sign(payload)).resolves.toMatchObject({ id: 'signed' });
  });

  it('does not mint a status entry or include credentialStatus when given an empty purpose list', async () => {
    // Catches a regression that rejects the deployment no-status choice or signs an empty credentialStatus member.
    mockedHttpFetch.mockResolvedValueOnce(
      response({
        verifiableCredential: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          id: 'signed-without-status',
          type: 'EnvelopedVerifiableCredential',
        },
      }),
    );
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(adapter.sign(payload, { statusPurposes: [] })).resolves.toMatchObject({ id: 'signed-without-status' });

    expect(mockedHttpFetch).toHaveBeenCalledTimes(1);
    const issueBody = JSON.parse(mockedHttpFetch.mock.calls[0][1]?.body as string);
    expect(issueBody.credential).not.toHaveProperty('credentialStatus');
  });

  it('rejects an empty context in the issue response', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response(entry())).mockResolvedValueOnce(
      response({
        verifiableCredential: {
          '@context': [],
          id: 'signed',
          type: 'EnvelopedVerifiableCredential',
        },
      }),
    );
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(adapter.sign(payload)).rejects.toMatchObject({ constructor: VcSignError });
  });

  it('rejects duplicate purposes before minting an entry and surfaces provider refusal', async () => {
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(adapter.sign(payload, { statusPurposes: 'revocation' as never })).rejects.toBeInstanceOf(
      VcStatusEntryUnsupportedError,
    );
    await expect(adapter.sign(payload, { statusPurposes: ['revocation', 'revocation'] })).rejects.toBeInstanceOf(
      VcStatusEntryUnsupportedError,
    );
    mockedHttpFetch.mockResolvedValueOnce(response({ message: 'purpose message is not supported' }, 400, 'Failure'));
    await expect(adapter.sign(payload, { statusPurposes: ['message'] })).rejects.toMatchObject({
      constructor: VcCredentialStatusError,
      message: expect.stringContaining('purpose message is not supported'),
    });
    await expect(adapter.sign(payload, { statusPurposes: ['   '] as never })).rejects.toMatchObject({
      constructor: VcStatusEntryUnsupportedError,
      reason: 'purpose',
    });
    expect(mockedHttpFetch).toHaveBeenCalledTimes(1);
  });

  it('warns with every orphaned coordinate when a later mint or issue fails', async () => {
    const first = entry({
      statusListCredential: 'http://localhost:3332/credentials/status/bitstring-status-list/1',
      statusListIndex: '7',
    });
    mockedHttpFetch
      .mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response({ message: 'status mint failed' }, 500, 'Failure'));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const mintFailureDispatch = jest.fn();

    await expect(
      adapter.sign(payload, { statusPurposes: ['revocation', 'suspension'], onDispatch: mintFailureDispatch }),
    ).rejects.toBeInstanceOf(VcCredentialStatusError);
    expect(mintFailureDispatch).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      {
        issuerDid: 'did:web:issuer.example',
        orphanedEntries: [
          {
            statusListCredential: 'http://localhost:3332/credentials/status/bitstring-status-list/1',
            statusListIndex: '7',
          },
        ],
      },
      'Credential status entries were minted before issuance failed',
    );

    mockWarn.mockClear();
    const issueFailureEvents: string[] = [];
    mockWarn.mockImplementationOnce(() => issueFailureEvents.push('warn'));
    mockedHttpFetch
      .mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response({ message: 'issue failed' }, 500, 'Failure'));
    const issueFailureDispatch = jest.fn(() => issueFailureEvents.push('dispatch'));
    await expect(adapter.sign(payload, { onDispatch: issueFailureDispatch })).rejects.toBeInstanceOf(VcSignError);
    expect(issueFailureDispatch).toHaveBeenCalledTimes(1);
    expect(issueFailureEvents).toEqual(['dispatch', 'warn']);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerDid: 'did:web:issuer.example',
        orphanedEntries: [expect.objectContaining({ statusListIndex: '7' })],
      }),
      'Credential status entries were minted before issuance failed',
    );

    mockWarn.mockClear();
    mockedHttpFetch.mockResolvedValueOnce(response({ message: 'first mint failed' }, 500, 'Failure'));
    await expect(adapter.sign(payload)).rejects.toBeInstanceOf(VcCredentialStatusError);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('sets a selected entry with the exact provider body and forwards the abort signal', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response({ status: true }));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const controller = new AbortController();

    await adapter.setCredentialStatus({
      statusListIssuer: 'did:web:issuer.example',
      entry: entry(),
      value: true,
      signal: controller.signal,
    });

    expect(mockedHttpFetch).toHaveBeenCalledWith(
      'https://vckit.example.com/agent/setBitstringStatus',
      expect.objectContaining({ method: 'POST', signal: controller.signal }),
    );
    expect(JSON.parse(mockedHttpFetch.mock.calls[0][1]?.body as string)).toEqual({
      statusListCredential: 'https://vckit.example.com/status/1',
      statusListVCIssuer: 'did:web:issuer.example',
      statusPurpose: 'revocation',
      index: 42,
      status: true,
    });
  });

  it('uses the serialisation hook before dispatching a status set', async () => {
    // Catches a regression that lets a status-list rewrite bypass the same lock used by minting.
    const refusal = new Error('dispatch refused');
    const refuse = jest.fn().mockRejectedValue(refusal);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        serialise: refuse,
        signal: defaultSignal,
      }),
    ).rejects.toBe(refusal);

    expect(refuse).toHaveBeenCalledTimes(1);
    expect(refuse).toHaveBeenCalledWith(
      'status-list:https://vckit.example.com:did:web:issuer.example',
      expect.any(Function),
      defaultSignal,
    );
    expect(mockedHttpFetch).not.toHaveBeenCalled();
  });

  it('passes through the serialisation hook and exposes the private origin and issuer key', async () => {
    // Catches a regression that serialises under a different key from the mint path or omits the provider write.
    mockedHttpFetch.mockResolvedValueOnce(response({ status: true }));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const serialise = jest.fn(async (key: string, fn: () => Promise<void>, signal?: AbortSignal) => {
      expect(key).toBe('status-list:https://vckit.example.com:did:web:issuer.example');
      expect(signal).toBe(defaultSignal);
      return fn();
    });

    await adapter.setCredentialStatus({
      statusListIssuer: 'did:web:issuer.example',
      entry: entry(),
      value: true,
      serialise,
      signal: defaultSignal,
    });

    expect(serialise).toHaveBeenCalledTimes(1);
    expect(mockedHttpFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [302, true],
    [400, false],
    [500, true],
  ])('maps HTTP %i set failures to mayHaveApplied=%s and preserves provider detail', async (status, mayHaveApplied) => {
    mockedHttpFetch.mockResolvedValueOnce(response({ error: '"position" must be number.' }, status, 'Failure'));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    try {
      await adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      });
      fail('Expected status set to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(VcStatusSetError);
      expect((error as VcStatusSetError).mayHaveApplied).toBe(mayHaveApplied);
      expect((error as Error).message).toContain('"position" must be number.');
    }
  });

  it('maps a provider 404 on set to a definite refusal', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response({ error: { message: 'not found' } }, 404, 'Not Found'));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusSetError,
      mayHaveApplied: false,
      statusCode: 404,
      message: expect.stringContaining('not found'),
    });
  });

  it('rejects a non-boolean status value before sending a set request', async () => {
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: 'true' as never,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusEntryUnsupportedError, reason: 'input' });
    expect(mockedHttpFetch).not.toHaveBeenCalled();
  });

  it('requires and compares the echoed status on every non-204 successful set', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response({ error: 'list is read-only' }));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusSetError, mayHaveApplied: true, statusCode: 200 });

    mockedHttpFetch.mockResolvedValueOnce(response(null));
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusSetError, mayHaveApplied: true });

    const nonErrorBodyResponse = response({});
    nonErrorBodyResponse.json = jest.fn().mockRejectedValue('invalid JSON');
    mockedHttpFetch.mockResolvedValueOnce(nonErrorBodyResponse);
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusSetError,
      message: expect.stringContaining('Status set response could not be parsed or validated'),
    });

    const cause = new Error('invalid JSON');
    const invalidJsonResponse = response({ status: true });
    invalidJsonResponse.json = jest.fn().mockRejectedValue(cause);
    mockedHttpFetch.mockResolvedValueOnce(invalidJsonResponse);
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusSetError, mayHaveApplied: true, cause });

    mockedHttpFetch.mockResolvedValueOnce(response({ status: false }));
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusSetError,
      mayHaveApplied: true,
      message: expect.stringContaining('provider reported false after a request for true'),
    });
  });

  it('rejects a body-less 2xx set as possibly applied', async () => {
    mockedHttpFetch.mockResolvedValueOnce({ ok: true, status: 204, statusText: 'No Content' } as Response);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusSetError, mayHaveApplied: true });
  });

  it('rejects a 200 response that cannot provide a body', async () => {
    mockedHttpFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' } as Response);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusSetError, mayHaveApplied: true, cause: expect.any(TypeError) });
  });

  it('sends an open purpose and refuses an unsafe index before sending that request', async () => {
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    mockedHttpFetch.mockResolvedValueOnce(response({ message: 'message is not supported' }, 400, 'Failure'));
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry({ statusPurpose: 'message' }),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusSetError,
      mayHaveApplied: false,
      message: expect.stringContaining('message is not supported'),
    });
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry({ statusListIndex: '9007199254740993' }),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toBeInstanceOf(VcStatusEntryUnsupportedError);
    expect(mockedHttpFetch).toHaveBeenCalledTimes(1);
  });

  it('validates entry before issuer and drops unknown request fields', async () => {
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: '',
        entry: null as unknown as CredentialStatusEntry,
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusEntryUnsupportedError, reason: 'input' });

    mockedHttpFetch.mockResolvedValueOnce(response({ revoked: false, errors: [] }));
    await adapter.getCredentialStatus({
      statusListIssuer: 'did:web:issuer.example',
      entry: { ...entry(), foo: 1 },
      signal: defaultSignal,
    });
    const requestBody = JSON.parse(mockedHttpFetch.mock.calls[0][1]?.body as string);
    expect(requestBody.verifiableCredential.credentialStatus.foo).toBeUndefined();
  });

  it('rejects empty or non-string status-list issuers on both methods', async () => {
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 123 as unknown as string,
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusEntryUnsupportedError, reason: 'input' });
    await expect(
      adapter.getCredentialStatus({ statusListIssuer: '', entry: entry(), signal: defaultSignal }),
    ).rejects.toMatchObject({
      constructor: VcStatusEntryUnsupportedError,
      reason: 'input',
    });
    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: ' did:web:x',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusEntryUnsupportedError, reason: 'input' });
    await expect(
      adapter.getCredentialStatus({ statusListIssuer: 'did:web:x ', entry: entry(), signal: defaultSignal }),
    ).rejects.toMatchObject({
      constructor: VcStatusEntryUnsupportedError,
      reason: 'input',
    });
    expect(mockedHttpFetch).not.toHaveBeenCalled();
  });

  it('refuses a leading-space issuer when minting status', async () => {
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.sign({ ...payload, issuer: { ...payload.issuer, id: ' did:web:x' as never } }),
    ).rejects.toBeInstanceOf(VcCredentialStatusError);
    expect(mockedHttpFetch).not.toHaveBeenCalled();
  });

  it('returns the selected clear bit only when the provider reports no errors', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response({ revoked: false, errors: [] }));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const controller = new AbortController();

    const result = await adapter.getCredentialStatus({
      statusListIssuer: 'did:web:issuer.example',
      entry: entry(),
      signal: controller.signal,
    });

    expect(result.value).toBe(false);
    expect(result.statusPurpose).toBe('revocation');
    expect(result.statusListIndex).toBe('42');
    expect(Number.isNaN(Date.parse(result.observedAt))).toBe(false);
    expect(mockedHttpFetch).toHaveBeenCalledWith(
      'https://vckit.example.com/agent/checkBitstringStatus',
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(JSON.parse(mockedHttpFetch.mock.calls[0][1]?.body as string)).toEqual({
      verifiableCredential: {
        credentialStatus: {
          type: 'BitstringStatusListEntry',
          statusPurpose: 'revocation',
          statusListIndex: 42,
          statusListCredential: 'https://vckit.example.com/status/1',
          id: 'https://vckit.example.com/status/1#42',
        },
        issuer: { id: 'did:web:issuer.example' },
      },
    });
  });

  it('treats an absent errors field as an observation with the selected bit', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response({ revoked: true }));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).resolves.toMatchObject({ value: true, statusPurpose: 'revocation' });
  });

  it.each([
    ['errors is not an array', { revoked: false, errors: {} }],
    ['an error entry is not an object', { revoked: false, errors: [null] }],
    ['an error message is missing', { revoked: false, errors: [{}] }],
    ['an error message is empty', { revoked: false, errors: [{ message: '' }] }],
  ])('rejects malformed status-check response when %s', async (_case, body) => {
    mockedHttpFetch.mockResolvedValueOnce(response(body));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toBeInstanceOf(VcStatusResponseInvalidError);
  });

  it('reads the selected entry from a dual credential independently for each purpose', async () => {
    mockedHttpFetch
      .mockResolvedValueOnce(response({ revoked: false, errors: [] }))
      .mockResolvedValueOnce(response({ revoked: true, errors: [] }));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const revocation = entry({ statusPurpose: 'revocation', statusListIndex: '1' });
    const suspension = entry({
      statusPurpose: 'suspension',
      statusListIndex: '2',
      statusListCredential: 'https://vckit.example.com/status/2',
      id: 'https://vckit.example.com/status/2#2',
    });

    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: revocation,
        signal: defaultSignal,
      }),
    ).resolves.toMatchObject({
      statusPurpose: 'revocation',
      value: false,
    });
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: suspension,
        signal: defaultSignal,
      }),
    ).resolves.toMatchObject({
      statusPurpose: 'suspension',
      value: true,
    });
    expect(
      JSON.parse(mockedHttpFetch.mock.calls[0][1]?.body as string).verifiableCredential.credentialStatus.statusPurpose,
    ).toBe('revocation');
    expect(
      JSON.parse(mockedHttpFetch.mock.calls[1][1]?.body as string).verifiableCredential.credentialStatus.statusPurpose,
    ).toBe('suspension');
  });

  // These bodies derive from VCKit 1.2.1 packages/bitstringStatusList/src/bitstring-status-list-status.ts lines 244-321.
  // Transcript labels exercised by the fixtures: check:dual-rev, check:dual-susp, set:dual-susp-true,
  // set:string-index, mint:revocation, and mint:suspension.
  it.each([
    'Could not load "BitstringStatusListCredential"; reason: request failed',
    'Unknown error',
    'The status purpose of the credential does not match the status purpose of the status list credential.',
    'The issuer of the credential does not match the issuer of the status list credential.',
  ])('any error entry, whatever its message, is a read failure: %s', async (message) => {
    mockedHttpFetch.mockResolvedValueOnce(response({ revoked: true, errors: [{ message }] }));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusReadError,
      message: expect.stringContaining(message),
    });
  });

  it('rejects malformed provider bodies and maps a missing list', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response({ revoked: 'true', errors: [] }));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toBeInstanceOf(VcStatusResponseInvalidError);

    mockedHttpFetch.mockResolvedValueOnce(response(null));
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toBeInstanceOf(VcStatusResponseInvalidError);

    mockedHttpFetch.mockResolvedValueOnce(response({ error: 'not found' }, 404, 'Not Found'));
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toBeInstanceOf(VcStatusListNotFoundError);
  });

  it('maps a read body parse rejection to a read failure with its cause and extracts nested details', async () => {
    const cause = new Error('aborted while reading JSON');
    cause.name = 'AbortError';
    const body = response(undefined);
    body.json = jest.fn().mockRejectedValue(cause);
    mockedHttpFetch.mockResolvedValueOnce(body);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusReadError, cause });

    mockedHttpFetch.mockResolvedValueOnce(
      response({ error: { message: 'nested provider detail' } }, 400, 'Bad Request'),
    );
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusReadError,
      message: expect.stringContaining('nested provider detail'),
    });
  });

  it('maps a non-empty message without errors to a read failure', async () => {
    mockedHttpFetch.mockResolvedValueOnce(
      response({ revoked: false, message: 'credentialStatus property was not set on the original credential' }),
    );
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusReadError,
      message: expect.stringContaining('credentialStatus property was not set on the original credential'),
    });
  });

  it('falls back to the HTTP status when a non-ok response body cannot be read', async () => {
    const body = response(undefined, 500, 'Internal Server Error');
    body.json = jest.fn().mockRejectedValue(new Error('invalid JSON'));
    mockedHttpFetch.mockResolvedValueOnce(body);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusReadError,
      message: expect.stringContaining('HTTP 500: Internal Server Error'),
    });

    mockedHttpFetch.mockResolvedValueOnce(response([], 400, 'Bad Request'));
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusReadError,
      message: expect.stringContaining('HTTP 400: Bad Request'),
    });
  });

  it('reads top-level message and detail response keys', async () => {
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    mockedHttpFetch.mockResolvedValueOnce(response({ message: 'message detail' }, 400, 'Bad Request'));
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('message detail') });

    mockedHttpFetch.mockResolvedValueOnce(response({ detail: 'detail detail' }, 400, 'Bad Request'));
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('detail detail') });
  });

  it('maps aborted status calls with the abort as cause and sends no request when already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusSetError, cause: reason, mayHaveApplied: false });
    await expect(
      adapter.getCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ constructor: VcStatusReadError, cause: reason });
    expect(mockedHttpFetch).not.toHaveBeenCalled();
  });

  it('maps a pre-flight sign abort to credential status failure without sending a request', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled before mint');
    controller.abort(reason);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const onDispatch = jest.fn();

    await expect(adapter.sign(payload, { signal: controller.signal, onDispatch })).rejects.toMatchObject({
      constructor: VcCredentialStatusError,
      cause: reason,
      message: expect.stringContaining('Failed to issue credential status'),
    });
    expect(onDispatch).not.toHaveBeenCalled();
    expect(mockedHttpFetch).not.toHaveBeenCalled();
  });

  it('does not dispatch when the status-list mint request is aborted', async () => {
    // Catches a regression that treats an aborted status-list request as proof that the credential request was sent.
    const controller = new AbortController();
    const reason = new Error('cancelled during mint');
    mockedHttpFetch.mockImplementationOnce(async () => {
      controller.abort(reason);
      throw reason;
    });
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const onDispatch = jest.fn();

    await expect(adapter.sign(payload, { signal: controller.signal, onDispatch })).rejects.toMatchObject({
      constructor: VcCredentialStatusError,
      cause: reason,
    });
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it('accepts a string issuer when minting status entries', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response(entry())).mockResolvedValueOnce(
      response({
        verifiableCredential: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          id: 'signed',
          type: 'EnvelopedVerifiableCredential',
        },
      }),
    );
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.sign({ ...payload, issuer: 'did:web:issuer.example' } as unknown as CredentialPayload),
    ).resolves.toEqual({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'signed',
      type: 'EnvelopedVerifiableCredential',
    });
    expect(JSON.parse(mockedHttpFetch.mock.calls[0][1]?.body as string)).toEqual({
      statusPurpose: 'revocation',
      bitstringStatusIssuer: 'did:web:issuer.example',
    });
  });

  it('supplies default context and type arrays when constructing an issue request', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response(entry())).mockResolvedValueOnce(
      response({
        verifiableCredential: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          id: 'signed',
          type: 'EnvelopedVerifiableCredential',
        },
      }),
    );
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const incompletePayload = { ...payload, '@context': undefined, type: undefined } as unknown as CredentialPayload;

    await adapter.sign(incompletePayload);
    const issueBody = JSON.parse(mockedHttpFetch.mock.calls[1][1]?.body as string);
    expect(issueBody.credential['@context']).toEqual(['https://www.w3.org/ns/credentials/v2']);
    expect(issueBody.credential.type).toEqual(['VerifiableCredential']);
  });

  it('marks a lost set request as possibly applied and keeps its cause', async () => {
    const cause = new Error('connection lost');
    mockedHttpFetch.mockRejectedValueOnce(cause);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(
      adapter.setCredentialStatus({
        statusListIssuer: 'did:web:issuer.example',
        entry: entry(),
        value: true,
        signal: defaultSignal,
      }),
    ).rejects.toMatchObject({
      constructor: VcStatusSetError,
      mayHaveApplied: true,
      cause,
    });
  });

  it('forwards the signal and wraps the rejection', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled while waiting');
    mockedHttpFetch.mockImplementationOnce(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(reason), { once: true });
        }),
    );
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const pending = adapter.getCredentialStatus({
      statusListIssuer: 'did:web:issuer.example',
      entry: entry(),
      signal: controller.signal,
    });
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ constructor: VcStatusReadError, cause: reason });
    expect(mockedHttpFetch.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('maps an abort that arrives while a set request is pending to possibly applied', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled while setting');
    mockedHttpFetch.mockImplementationOnce(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(reason), { once: true });
        }),
    );
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    const pending = adapter.setCredentialStatus({
      statusListIssuer: 'did:web:issuer.example',
      entry: entry(),
      value: true,
      signal: controller.signal,
    });
    controller.abort(reason);
    await expect(pending).rejects.toMatchObject({ constructor: VcStatusSetError, mayHaveApplied: true, cause: reason });
  });

  it('wraps issue and mint transport and body failures with causes', async () => {
    const transportCause = new Error('mint transport');
    mockedHttpFetch.mockRejectedValueOnce(transportCause);
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await expect(adapter.sign(payload)).rejects.toMatchObject({
      constructor: VcCredentialStatusError,
      cause: transportCause,
    });

    mockedHttpFetch.mockResolvedValueOnce(response({ type: 'Wrong' }));
    await expect(adapter.sign(payload)).rejects.toMatchObject({
      constructor: VcCredentialStatusError,
      code: 'VC_STATUS_FAILED',
    });

    const mintJsonCause = new Error('mint invalid JSON');
    const mintJsonResponse = response(entry());
    mintJsonResponse.json = jest.fn().mockRejectedValue(mintJsonCause);
    mockedHttpFetch.mockResolvedValueOnce(mintJsonResponse);
    await expect(adapter.sign(payload)).rejects.toMatchObject({
      constructor: VcCredentialStatusError,
      cause: mintJsonCause,
    });

    mockedHttpFetch.mockResolvedValueOnce(response(entry()));
    const issueCause = new Error('issue transport');
    mockedHttpFetch.mockRejectedValueOnce(issueCause);
    await expect(adapter.sign(payload)).rejects.toMatchObject({ constructor: VcSignError, cause: issueCause });

    mockedHttpFetch.mockResolvedValueOnce(response(entry()));
    mockedHttpFetch.mockResolvedValueOnce(response({}));
    await expect(adapter.sign(payload)).rejects.toMatchObject({
      constructor: VcSignError,
      message: expect.stringContaining('missing verifiableCredential'),
    });

    mockedHttpFetch.mockResolvedValueOnce(response(entry()));
    mockedHttpFetch.mockResolvedValueOnce(response(null));
    await expect(adapter.sign(payload)).rejects.toMatchObject({
      constructor: VcSignError,
      message: expect.stringContaining('non-object response body'),
    });

    mockedHttpFetch.mockResolvedValueOnce(response(entry()));
    mockedHttpFetch.mockResolvedValueOnce(
      response({
        verifiableCredential: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          id: 7,
          type: 'Wrong',
        },
      }),
    );
    await expect(adapter.sign(payload)).rejects.toMatchObject({
      constructor: VcSignError,
      message: expect.stringContaining('invalid enveloped credential'),
    });

    mockedHttpFetch.mockResolvedValueOnce(response(entry()));
    const issueJsonCause = new Error('issue invalid JSON');
    const issueJsonResponse = response({});
    issueJsonResponse.json = jest.fn().mockRejectedValue(issueJsonCause);
    mockedHttpFetch.mockResolvedValueOnce(issueJsonResponse);
    await expect(adapter.sign(payload)).rejects.toMatchObject({ constructor: VcSignError, cause: issueJsonCause });
  });

  it('uses provider response detail for non-ok mint and issue calls', async () => {
    mockedHttpFetch.mockResolvedValueOnce(response({ error: { message: 'mint endpoint detail' } }, 500, 'Failure'));
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

    await expect(adapter.sign(payload)).rejects.toMatchObject({
      constructor: VcCredentialStatusError,
      message: expect.stringContaining('mint endpoint detail'),
    });

    mockedHttpFetch
      .mockResolvedValueOnce(response(entry()))
      .mockResolvedValueOnce(response({ error: { message: 'issue endpoint detail' } }, 500, 'Failure'));
    await expect(adapter.sign(payload)).rejects.toMatchObject({
      constructor: VcSignError,
      message: expect.stringContaining('issue endpoint detail'),
    });
  });

  it('passes the signal to the serialisation hook and supplies the origin key', async () => {
    const controller = new AbortController();
    mockedHttpFetch.mockResolvedValueOnce(response(entry())).mockResolvedValueOnce(
      response({
        verifiableCredential: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          id: 'signed',
          type: 'EnvelopedVerifiableCredential',
        },
      }),
    );
    const seen: unknown[] = [];
    const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
    await adapter.sign(payload, {
      signal: controller.signal,
      serialise: async (key, fn, signal) => {
        seen.push(key, signal);
        return fn();
      },
    });
    expect(seen).toEqual(['status-list:https://vckit.example.com:did:web:issuer.example', controller.signal]);
  });
});
