import { evaluateValidityWindow } from './validity-window.js';

const NOW = new Date('2026-09-11T00:00:00.000Z');

describe('evaluateValidityWindow', () => {
  it('fails an expired credential, naming the bound', () => {
    expect(
      evaluateValidityWindow({ validFrom: '2020-01-01T00:00:00Z', validUntil: '2021-01-01T00:00:00Z' }, NOW),
    ).toEqual({
      result: 'fail',
      reason: 'expired',
      message: expect.stringContaining('validUntil 2021-01-01T00:00:00.000Z'),
    });
  });

  it('fails a credential that is not yet valid', () => {
    expect(evaluateValidityWindow({ validFrom: '2035-01-01T00:00:00Z' }, NOW)).toMatchObject({
      result: 'fail',
      reason: 'not_yet_valid',
    });
  });

  it('passes inside the window, exactly on a bound, and with no bound at all', () => {
    expect(
      evaluateValidityWindow({ validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z' }, NOW),
    ).toEqual({ result: 'pass' });
    expect(evaluateValidityWindow({ validFrom: NOW.toISOString() }, NOW)).toEqual({ result: 'pass' });
    expect(evaluateValidityWindow({ validUntil: NOW.toISOString() }, NOW)).toEqual({ result: 'pass' });
    // VCDM 2.0: with neither bound the credential is valid indefinitely.
    expect(evaluateValidityWindow({}, NOW)).toEqual({ result: 'pass' });
    expect(evaluateValidityWindow({ validFrom: undefined, validUntil: undefined }, NOW)).toEqual({ result: 'pass' });
    expect(evaluateValidityWindow({ validUntil: '2035-01-01T00:00:00+14:00' }, NOW)).toEqual({ result: 'pass' });
    expect(evaluateValidityWindow({ validUntil: '2035-01-01T00:00:00.250-13:59' }, NOW)).toEqual({ result: 'pass' });
  });

  it('fails a bound that is present but not a date-time, and never normalises an impossible date', () => {
    // A violated readable bound wins over an unreadable one; otherwise an
    // unreadable bound fails the credential rather than being dropped.
    expect(evaluateValidityWindow({ validFrom: 'yesterday', validUntil: '2021-01-01T00:00:00Z' }, NOW)).toMatchObject({
      result: 'fail',
      reason: 'expired',
    });
    expect(evaluateValidityWindow({ validFrom: '2020-01-01T00:00:00Z', validUntil: 'never' }, NOW)).toEqual({
      result: 'fail',
      reason: 'unreadable_bound',
      message: 'validUntil could not be read as a date-time',
    });
    expect(evaluateValidityWindow({ validFrom: 12345, validUntil: {} }, NOW)).toMatchObject({
      message: 'validFrom and validUntil could not be read as a date-time',
    });
    // 30 February is not a date; it must not become 2 March and then expire.
    expect(evaluateValidityWindow({ validUntil: '2021-02-30T00:00:00Z' }, NOW)).toMatchObject({
      reason: 'unreadable_bound',
    });
    // XML Schema's end-of-day form is outside the supported profile.
    expect(evaluateValidityWindow({ validUntil: '2030-12-31T24:00:00Z' }, NOW)).toMatchObject({
      reason: 'unreadable_bound',
    });
    // An explicit null is a present value the data model does not allow.
    expect(evaluateValidityWindow({ validUntil: null }, NOW)).toMatchObject({ reason: 'unreadable_bound' });
    // Only the dateTimeStamp form: uppercase separators and offsets within 14 hours.
    expect(evaluateValidityWindow({ validUntil: '2035-01-01t00:00:00z' }, NOW)).toMatchObject({
      reason: 'unreadable_bound',
    });
    expect(evaluateValidityWindow({ validUntil: '2035-01-01T00:00:00+23:59' }, NOW)).toMatchObject({
      reason: 'unreadable_bound',
    });
    expect(evaluateValidityWindow({ validUntil: '2035-01-01T00:00:00+14:01' }, NOW)).toMatchObject({
      reason: 'unreadable_bound',
    });
  });

  it('refuses an invalid clock rather than judging against it', () => {
    expect(() => evaluateValidityWindow({ validUntil: '2021-01-01T00:00:00Z' }, new Date('not a date'))).toThrow(
      TypeError,
    );
  });
});
