import { checkValidityWindow } from './validity-window.js';
import type { EnvelopedVerifiableCredential } from '../types.js';

// jose ships ESM the services Jest config does not transform; the decoder
// only needs the payload segment read, which this mock does for real.
jest.mock('jose', () => ({
  decodeJwt: (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')),
}));

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

function enveloped(claims: Record<string, unknown>): EnvelopedVerifiableCredential {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${b64({ alg: 'EdDSA', typ: 'vc+jwt' })}.${b64(claims)}.sig`,
  } as EnvelopedVerifiableCredential;
}

const NOW = new Date('2026-09-11T00:00:00.000Z');

describe('checkValidityWindow', () => {
  it('fails an expired credential and names the bound', () => {
    const outcome = checkValidityWindow(
      enveloped({ validFrom: '2020-01-01T00:00:00Z', validUntil: '2021-01-01T00:00:00Z' }),
      NOW,
    );
    expect(outcome).toEqual({
      result: 'fail',
      reason: 'expired',
      message: expect.stringContaining('validUntil 2021-01-01T00:00:00.000Z'),
    });
  });

  it('fails a credential that is not yet valid', () => {
    expect(checkValidityWindow(enveloped({ validFrom: '2035-01-01T00:00:00Z' }), NOW)).toMatchObject({
      result: 'fail',
      reason: 'not_yet_valid',
    });
  });

  it('passes a credential inside its window, including exactly on a bound', () => {
    expect(
      checkValidityWindow(enveloped({ validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z' }), NOW),
    ).toEqual({ result: 'pass' });
    expect(checkValidityWindow(enveloped({ validFrom: NOW.toISOString() }), NOW)).toEqual({ result: 'pass' });
    expect(checkValidityWindow(enveloped({ validUntil: NOW.toISOString() }), NOW)).toEqual({ result: 'pass' });
  });

  it('passes a credential with no bound (valid indefinitely) and does not run on an undecodable envelope', () => {
    expect(checkValidityWindow(enveloped({ type: ['VerifiableCredential'] }), NOW)).toEqual({ result: 'pass' });
    expect(
      checkValidityWindow(
        {
          '@context': [],
          type: 'EnvelopedVerifiableCredential',
          id: 'data:application/vc+jwt,not.a.jwt',
        } as unknown as EnvelopedVerifiableCredential,
        NOW,
      ),
    ).toEqual({ result: 'not_run', reason: 'undecodable' });
  });

  it('fails a bound that is present but cannot be read, and still fails a readable bound that is violated', () => {
    expect(checkValidityWindow(enveloped({ validFrom: '2020-01-01T00:00:00Z', validUntil: 'never' }), NOW)).toEqual({
      result: 'fail',
      reason: 'unreadable_bound',
      message: 'validUntil could not be read as a date-time',
    });
    expect(
      checkValidityWindow(enveloped({ validFrom: 'yesterday', validUntil: '2021-01-01T00:00:00Z' }), NOW),
    ).toMatchObject({
      result: 'fail',
      reason: 'expired',
    });
  });
});
