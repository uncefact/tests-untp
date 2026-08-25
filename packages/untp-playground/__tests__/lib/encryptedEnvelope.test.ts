import { isEncryptedEnvelope } from '@/lib/encryptedEnvelope';

const b64u = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('isEncryptedEnvelope', () => {
  it.each([
    [
      'AES-GCM storage envelope',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'aes-256-gcm' },
      true,
    ],
    [
      'envelope fields without the algorithm type',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==' },
      false,
    ],
    [
      'unsupported algorithm',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'rot13' },
      false,
    ],
    [
      'another AES variant',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'aes-128-gcm' },
      true,
    ],
    [
      'spec-style AES-128 casing',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'AES-128' },
      true,
    ],
    [
      'bare AES family',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'AES' },
      true,
    ],
    [
      'AES below the 128-bit minimum',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'aes-064-x' },
      false,
    ],
    [
      'two-digit AES width',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'aes-64-gcm' },
      false,
    ],
    [
      'non-NIST width',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'aes-999-x' },
      false,
    ],
    [
      'garbage after the family name',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'aes garbage' },
      false,
    ],
    [
      'width glued to a suffix digit',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'aes-1280' },
      false,
    ],
    [
      'underscore separators',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'aes_128_gcm' },
      true,
    ],
    [
      'no separators at all',
      { cipherText: 'SGVsbG8=', iv: 'nLUYsnXBY8bbXY45', tag: '7j0RRSoEIm2FAo52m1pyow==', type: 'AES128CBC' },
      true,
    ],
    [
      'a pathological aesa token stays linear and rejects',
      {
        cipherText: 'SGVsbG8=',
        iv: 'nLUYsnXBY8bbXY45',
        tag: '7j0RRSoEIm2FAo52m1pyow==',
        type: 'aesa' + 'a'.repeat(50) + '!',
      },
      false,
    ],
    [
      'over-long tokens reject outright',
      {
        cipherText: 'SGVsbG8=',
        iv: 'nLUYsnXBY8bbXY45',
        tag: '7j0RRSoEIm2FAo52m1pyow==',
        type: 'aes-' + 'gcm-'.repeat(30) + 'x',
      },
      false,
    ],
    ['malformed base64 fields', { cipherText: 'a', iv: 'b', tag: 'c', type: 'aes-256-gcm' }, false],
    [
      'JSON-serialised JWE with a decodable protected header',
      { protected: b64u('{"alg":"ECDH-ES","enc":"A256GCM"}'), ciphertext: 'abc' },
      true,
    ],
    [
      'JSON-serialised JWE with alg/enc in the unprotected header',
      { unprotected: { alg: 'dir', enc: 'A128GCM' }, ciphertext: 'abc', iv: 'x' },
      true,
    ],
    [
      'JSON-serialised JWE with per-recipient headers',
      { recipients: [{ header: { alg: 'A128KW', enc: 'A128GCM' } }], ciphertext: 'abc' },
      true,
    ],
    ['member presence without a JOSE header is not a JWE', { protected: 'x', ciphertext: 'abc' }, false],
    [
      'a credential carrying ciphertext and header claims',
      {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'DigitalProductPassport'],
        issuer: 'did:example:issuer',
        ciphertext: 'a public claim value',
        header: { label: 'claim metadata' },
      },
      false,
    ],
    ['compact JWE string', `${b64u('{"alg":"ECDH-ES","enc":"A256GCM"}')}..${b64u('iv')}.${b64u('ct')}.`, true],
    ['ordinary credential', { type: ['VerifiableCredential'] }, false],
    ['credential mentioning cipherText only', { type: ['VerifiableCredential'], cipherText: 'notes' }, false],
    ['compact JWS (three segments)', `${b64u('{"alg":"none"}')}.${b64u('{"vc":1}')}.`, false],
    ['five random segments without a JWE header', 'aaaa.bbbb.cccc.dddd.eeee', false],
    ['null', null, false],
    ['array', [], false],
  ])('%s -> %s', (_name, value, expected) => {
    expect(isEncryptedEnvelope(value)).toBe(expected);
  });
});
