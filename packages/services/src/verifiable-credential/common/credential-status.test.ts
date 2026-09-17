import { canonicalStatusListIndex, parseCredentialStatus, parseCredentialStatusEntry } from './credential-status';
import { VcStatusEntryUnsupportedError, VcStatusResponseInvalidError } from '../errors';

const baseEntry = {
  id: 'https://example.com/status/1#0',
  type: 'BitstringStatusListEntry' as const,
  statusPurpose: 'revocation',
  statusListIndex: '0',
  statusListCredential: 'https://example.com/status/1',
};

describe('credential status parsing', () => {
  it('canonicalises the index and strips unknown decoded fields', () => {
    expect(
      parseCredentialStatusEntry({ ...baseEntry, statusListIndex: 42, custom: 'removed' }, { source: 'provider' }),
    ).toEqual({
      ...baseEntry,
      statusListIndex: '42',
    });
  });

  it('accepts one or many entries in order and canonicalises an array element', () => {
    expect(
      parseCredentialStatus(
        [
          { ...baseEntry, statusPurpose: 'revocation', statusListIndex: '0' },
          { ...baseEntry, statusPurpose: 'suspension', statusListIndex: 1 },
        ],
        { source: 'provider' },
      ),
    ).toEqual([
      { ...baseEntry, statusPurpose: 'revocation', statusListIndex: '0' },
      { ...baseEntry, statusPurpose: 'suspension', statusListIndex: '1' },
    ]);
  });

  it('accepts statusSize one, statusReference forms, and a spec-shaped statusMessage', () => {
    expect(
      parseCredentialStatusEntry(
        {
          ...baseEntry,
          statusSize: 1,
          statusReference: ['https://example.com/reference/1', 'https://example.com/reference/2'],
          statusMessage: [
            { status: '0x0', message: 'The credential is valid' },
            { status: '0x1', message: 'The credential was revoked' },
          ],
        },
        { source: 'provider' },
      ),
    ).toMatchObject({
      statusSize: 1,
      statusReference: ['https://example.com/reference/1', 'https://example.com/reference/2'],
      statusMessage: [
        { status: '0x0', message: 'The credential is valid' },
        { status: '0x1', message: 'The credential was revoked' },
      ],
    });
    expect(
      parseCredentialStatusEntry(
        { ...baseEntry, statusReference: 'https://example.com/reference' },
        { source: 'provider' },
      ),
    ).toMatchObject({
      statusReference: 'https://example.com/reference',
    });
  });

  it('maps provider body failures to response invalid and input failures to unsupported', () => {
    expect(() => parseCredentialStatusEntry({ ...baseEntry, type: 'Other' }, { source: 'provider' })).toThrow(
      VcStatusResponseInvalidError,
    );
    expect(() =>
      parseCredentialStatusEntry({ ...baseEntry, statusListCredential: 'relative' }, { source: 'provider' }),
    ).toThrow(VcStatusResponseInvalidError);
    expect(() => parseCredentialStatusEntry({ ...baseEntry, statusSize: 2 }, { source: 'provider' })).toThrow(
      VcStatusResponseInvalidError,
    );
    expect(() => parseCredentialStatusEntry({ ...baseEntry, statusListIndex: '007' }, { source: 'input' })).toThrow(
      VcStatusEntryUnsupportedError,
    );
    try {
      parseCredentialStatusEntry({ ...baseEntry, statusSize: 2 }, { source: 'input' });
      fail('Expected statusSize 2 to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(VcStatusEntryUnsupportedError);
      expect(error).toMatchObject({ reason: 'statusSize' });
    }
    expect(parseCredentialStatus([], { source: 'provider' })).toEqual([]);
    expect(() => parseCredentialStatusEntry([], { source: 'provider' })).toThrow(VcStatusResponseInvalidError);
  });

  it('rejects malformed status messages for both input and provider entries', () => {
    expect(() => parseCredentialStatusEntry({ ...baseEntry, id: 7 }, { source: 'provider' })).toThrow(
      VcStatusResponseInvalidError,
    );
    expect(() => parseCredentialStatusEntry({ ...baseEntry, statusPurpose: '' }, { source: 'provider' })).toThrow(
      VcStatusResponseInvalidError,
    );
    expect(() =>
      parseCredentialStatusEntry({ ...baseEntry, statusListCredential: '' }, { source: 'provider' }),
    ).toThrow(VcStatusResponseInvalidError);
    expect(() => parseCredentialStatusEntry({ ...baseEntry, statusSize: '1' }, { source: 'provider' })).toThrow(
      VcStatusResponseInvalidError,
    );
    for (const source of ['input', 'provider'] as const) {
      expect(() => parseCredentialStatusEntry({ ...baseEntry, statusMessage: 'bad' }, { source })).toThrow(
        source === 'input' ? VcStatusEntryUnsupportedError : VcStatusResponseInvalidError,
      );
      expect(() =>
        parseCredentialStatusEntry(
          { ...baseEntry, statusMessage: [{ status: 'revoked', message: 'bad' }] },
          { source },
        ),
      ).toThrow(source === 'input' ? VcStatusEntryUnsupportedError : VcStatusResponseInvalidError);
    }
    expect(
      parseCredentialStatusEntry({ ...baseEntry, statusReference: 42 }, { source: 'provider' }),
    ).not.toHaveProperty('statusReference');
    expect(
      parseCredentialStatusEntry({ ...baseEntry, statusReference: 'javascript:alert(1)' }, { source: 'provider' }),
    ).not.toHaveProperty('statusReference');
  });

  it('requires a non-empty status id distinct from the status list credential', () => {
    for (const source of ['input', 'provider'] as const) {
      expect(() => parseCredentialStatusEntry({ ...baseEntry, id: '' }, { source })).toThrow(
        source === 'input' ? VcStatusEntryUnsupportedError : VcStatusResponseInvalidError,
      );
      expect(() =>
        parseCredentialStatusEntry({ ...baseEntry, id: baseEntry.statusListCredential }, { source }),
      ).toThrow(source === 'input' ? VcStatusEntryUnsupportedError : VcStatusResponseInvalidError);
    }
  });

  it('keeps well-formed optional fields and rejects unsafe status-list URLs', () => {
    expect(
      parseCredentialStatusEntry(
        {
          ...baseEntry,
          statusListCredential: 'http://localhost:3332/credentials/status/1',
          statusReference: 'https://example.com/reference',
          statusMessage: [
            { status: '0x0', message: 'The credential is valid' },
            { status: '0x1', message: 'The credential was revoked' },
          ],
        },
        { source: 'input' },
      ),
    ).toMatchObject({
      statusListCredential: 'http://localhost:3332/credentials/status/1',
      statusReference: 'https://example.com/reference',
      statusMessage: [
        { status: '0x0', message: 'The credential is valid' },
        { status: '0x1', message: 'The credential was revoked' },
      ],
    });
    for (const statusListCredential of ['javascript:alert(1)', 'data:,x', 'https://user:pw@host/list']) {
      expect(() => parseCredentialStatusEntry({ ...baseEntry, statusListCredential }, { source: 'provider' })).toThrow(
        VcStatusResponseInvalidError,
      );
    }
  });

  it('requires an untrimmed supported status purpose', () => {
    expect(parseCredentialStatusEntry({ ...baseEntry, statusPurpose: 'revocation' }, { source: 'provider' })).toEqual(
      expect.objectContaining({ statusPurpose: 'revocation' }),
    );
    expect(() =>
      parseCredentialStatusEntry({ ...baseEntry, statusPurpose: ' revocation' }, { source: 'provider' }),
    ).toThrow(VcStatusResponseInvalidError);
    try {
      parseCredentialStatusEntry({ ...baseEntry, statusPurpose: ' revocation' }, { source: 'input' });
      fail('Expected a trimmed status purpose to be rejected');
    } catch (error) {
      expect(error).toMatchObject({ reason: 'input' });
    }
  });

  it('keeps index conversion exact and reports input reasons', () => {
    expect(canonicalStatusListIndex(0, { source: 'provider' })).toBe('0');
    expect(canonicalStatusListIndex('9007199254740993', { source: 'provider' })).toBe('9007199254740993');
    expect(() => canonicalStatusListIndex(-1, { source: 'provider' })).toThrow(VcStatusResponseInvalidError);
    expect(() => canonicalStatusListIndex(undefined, { source: 'provider' })).toThrow(VcStatusResponseInvalidError);
    expect(() => canonicalStatusListIndex(-1, { source: 'input' })).toThrow(VcStatusEntryUnsupportedError);
    expect(() => canonicalStatusListIndex(1, { source: 'input' })).toThrow(VcStatusEntryUnsupportedError);
    expect(() => canonicalStatusListIndex('01', { source: 'provider' })).toThrow(VcStatusResponseInvalidError);
    expect(parseCredentialStatusEntry(baseEntry, { source: 'provider' })).toMatchObject({
      statusPurpose: 'revocation',
    });
    expect(parseCredentialStatus(baseEntry, { source: 'provider' })).toMatchObject({ statusPurpose: 'revocation' });
  });
});
