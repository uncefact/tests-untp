import {
  DEFAULT_MAX_TAG_LENGTH,
  DEFAULT_MAX_TAGS_PER_RECORD,
  readMaxTagLength,
  readMaxTagsPerRecord,
  warnOnRejectedLibraryTagLimitOverrides,
} from './library-tag-limits';

describe('readMaxTagsPerRecord and readMaxTagLength', () => {
  it('use the defaults of 10 tags and 64 characters when the variables are absent', () => {
    expect(DEFAULT_MAX_TAGS_PER_RECORD).toBe(10);
    expect(DEFAULT_MAX_TAG_LENGTH).toBe(64);
    expect(readMaxTagsPerRecord({})).toBe(10);
    expect(readMaxTagLength({})).toBe(64);
  });

  it('use a valid operator override', () => {
    const env = { API_MAX_TAGS_PER_RECORD: ' 12 ', API_MAX_TAG_LENGTH: '80' };

    expect(readMaxTagsPerRecord(env)).toBe(12);
    expect(readMaxTagLength(env)).toBe(80);
  });

  it('read the process environment at call time, so a later change applies without reloading', () => {
    const original = process.env.API_MAX_TAG_LENGTH;
    try {
      process.env.API_MAX_TAG_LENGTH = '5';
      expect(readMaxTagLength()).toBe(5);
      process.env.API_MAX_TAG_LENGTH = '6';
      expect(readMaxTagLength()).toBe(6);
    } finally {
      if (original === undefined) delete process.env.API_MAX_TAG_LENGTH;
      else process.env.API_MAX_TAG_LENGTH = original;
    }
  });
});

describe('warnOnRejectedLibraryTagLimitOverrides', () => {
  const originals = {
    API_MAX_TAGS_PER_RECORD: process.env.API_MAX_TAGS_PER_RECORD,
    API_MAX_TAG_LENGTH: process.env.API_MAX_TAG_LENGTH,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('warns with the variable and applied maximum when API_MAX_TAG_LENGTH is unusable', () => {
    delete process.env.API_MAX_TAGS_PER_RECORD;
    process.env.API_MAX_TAG_LENGTH = 'sixty';
    const warn = jest.fn();

    warnOnRejectedLibraryTagLimitOverrides({ warn });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { API_MAX_TAG_LENGTH: 'sixty', appliedMaximum: 64 },
      'API_MAX_TAG_LENGTH must be a positive integer; applying maximum 64 instead',
    );
  });

  it('warns with the variable and applied maximum when API_MAX_TAGS_PER_RECORD is unusable', () => {
    process.env.API_MAX_TAGS_PER_RECORD = '';
    delete process.env.API_MAX_TAG_LENGTH;
    const warn = jest.fn();

    warnOnRejectedLibraryTagLimitOverrides({ warn });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { API_MAX_TAGS_PER_RECORD: '', appliedMaximum: 10 },
      'API_MAX_TAGS_PER_RECORD must be a positive integer; applying maximum 10 instead',
    );
  });

  it('warns once for each setting when both are unusable', () => {
    process.env.API_MAX_TAGS_PER_RECORD = 'ten';
    process.env.API_MAX_TAG_LENGTH = '0';
    const warn = jest.fn();

    warnOnRejectedLibraryTagLimitOverrides({ warn });

    expect(warn.mock.calls.map(([context]) => Object.keys(context)[0])).toEqual([
      'API_MAX_TAGS_PER_RECORD',
      'API_MAX_TAG_LENGTH',
    ]);
  });

  it('stays silent for valid or absent overrides', () => {
    const warn = jest.fn();

    process.env.API_MAX_TAGS_PER_RECORD = '2';
    process.env.API_MAX_TAG_LENGTH = '80';
    warnOnRejectedLibraryTagLimitOverrides({ warn });
    delete process.env.API_MAX_TAGS_PER_RECORD;
    delete process.env.API_MAX_TAG_LENGTH;
    warnOnRejectedLibraryTagLimitOverrides({ warn });

    expect(warn).not.toHaveBeenCalled();
  });
});
