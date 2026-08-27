import { asDateTime } from './as-date-time.js';

describe('asDateTime', () => {
  it('returns the date and time a well-formed UTC value refers to', () => {
    expect(asDateTime('2024-01-15T00:00:00Z')).toEqual(new Date('2024-01-15T00:00:00.000Z'));
    expect(asDateTime('2024-01-15T10:30:00.250Z')).toEqual(new Date('2024-01-15T10:30:00.250Z'));
  });

  it('reads an offset value as the same moment in UTC', () => {
    expect(asDateTime('2024-01-15T23:30:00+10:00')).toEqual(new Date('2024-01-15T13:30:00.000Z'));
    expect(asDateTime('2024-01-15T00:30:00-05:00')).toEqual(new Date('2024-01-15T05:30:00.000Z'));
  });

  it('returns undefined for a day the calendar does not have, rather than normalising it', () => {
    expect(asDateTime('2024-02-30T00:00:00Z')).toBeUndefined();
    expect(asDateTime('2023-02-29T00:00:00Z')).toBeUndefined();
  });

  it('accepts a real leap day', () => {
    expect(asDateTime('2024-02-29T00:00:00Z')).toEqual(new Date('2024-02-29T00:00:00.000Z'));
  });

  it('returns undefined for a leap second', () => {
    // Well-formed RFC 3339, but JavaScript has no value for it.
    expect(asDateTime('1990-12-31T23:59:60Z')).toBeUndefined();
  });

  it.each([
    ['a date with no time', '2024-01-15'],
    ['a human-readable date', 'January 15, 2024'],
    ['a bare number', '0'],
    ['nonsense', 'not-a-date'],
    ['the empty string', ''],
    ['a time with no zone', '2024-01-15T00:00:00'],
  ])('returns undefined for %s', (_label, value) => {
    expect(asDateTime(value)).toBeUndefined();
  });

  it.each([
    ['number', 1705276800000],
    ['null', null],
    ['undefined', undefined],
    ['Date', new Date()],
    ['object', {}],
  ])('returns undefined for a non-string %s', (_label, value) => {
    expect(asDateTime(value)).toBeUndefined();
  });
});
