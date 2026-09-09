import {
  readFetchAllowPrivateUrls,
  readFetchMaxResponseSize,
  readFetchTimeoutMs,
  deriveHarnessAllowPrivateUrls,
  validateFetchSettingsOnBoot,
} from './credential-fetch.config';

const empty = {};

describe('readFetchAllowPrivateUrls', () => {
  it.each([undefined, '', '   '])('uses false when the setting is %p', (raw) => {
    expect(readFetchAllowPrivateUrls(raw === undefined ? empty : { FETCH_ALLOW_PRIVATE_URLS: raw })).toBe(false);
  });

  it.each(['false', 'TRUE', ' true ', '1', 'yes', 'arbitrary'])('enables only exact lowercase true, not %p', (raw) => {
    expect(readFetchAllowPrivateUrls({ FETCH_ALLOW_PRIVATE_URLS: raw })).toBe(false);
  });

  it('reads the new name and the deprecated name with the same parser', () => {
    expect(readFetchAllowPrivateUrls({ FETCH_ALLOW_PRIVATE_URLS: 'true' })).toBe(true);
    expect(readFetchAllowPrivateUrls({ VERIFY_ALLOW_PRIVATE_URLS: 'true' })).toBe(true);
  });

  // Fails if the resolver ever trims the value it selects: a padded old-name
  // value would then enable the bypass that the exact comparison refuses.
  it('does not trim the value it selects from the deprecated name', () => {
    expect(readFetchAllowPrivateUrls({ VERIFY_ALLOW_PRIVATE_URLS: ' true ' })).toBe(false);
  });

  it.each([
    ['equal values', 'true', 'true'],
    ['different values', 'false', 'true'],
    ['old invalid and new valid', 'not-a-boolean', 'true'],
  ])('rejects %s before parsing', (_label, oldValue, newValue) => {
    expect(() =>
      readFetchAllowPrivateUrls({ VERIFY_ALLOW_PRIVATE_URLS: oldValue, FETCH_ALLOW_PRIVATE_URLS: newValue }),
    ).toThrow(
      'VERIFY_ALLOW_PRIVATE_URLS and FETCH_ALLOW_PRIVATE_URLS are both set. VERIFY_ALLOW_PRIVATE_URLS was renamed to FETCH_ALLOW_PRIVATE_URLS in v0.5. Set FETCH_ALLOW_PRIVATE_URLS to the value you intend, remove VERIFY_ALLOW_PRIVATE_URLS, and restart.',
    );
  });

  it('treats blank deprecated input as unset', () => {
    expect(readFetchAllowPrivateUrls({ VERIFY_ALLOW_PRIVATE_URLS: ' ', FETCH_ALLOW_PRIVATE_URLS: 'true' })).toBe(true);
    expect(readFetchAllowPrivateUrls({ VERIFY_ALLOW_PRIVATE_URLS: ' ' })).toBe(false);
  });

  it('reflects environment changes on each invocation', () => {
    const env: Record<string, string | undefined> = {};
    expect(readFetchAllowPrivateUrls(env)).toBe(false);
    env.FETCH_ALLOW_PRIVATE_URLS = 'true';
    expect(readFetchAllowPrivateUrls(env)).toBe(true);
    env.FETCH_ALLOW_PRIVATE_URLS = 'false';
    expect(readFetchAllowPrivateUrls(env)).toBe(false);
  });
});

describe('readFetchMaxResponseSize', () => {
  it.each([undefined, '', '   '])('uses the 10 MB default when the setting is %p', (raw) => {
    expect(readFetchMaxResponseSize(raw === undefined ? empty : { FETCH_MAX_RESPONSE_SIZE: raw })).toBe(10_485_760);
  });

  it.each([
    ['FETCH_MAX_RESPONSE_SIZE', { FETCH_MAX_RESPONSE_SIZE: '2048' }],
    ['VERIFY_MAX_CREDENTIAL_SIZE', { VERIFY_MAX_CREDENTIAL_SIZE: '2048' }],
  ])('reads %s', (_label, env) => {
    expect(readFetchMaxResponseSize(env)).toBe(2048);
  });

  it.each(['2048junk', '2048.9', '1e3'])('preserves parseInt behaviour for %p', (raw) => {
    expect(readFetchMaxResponseSize({ FETCH_MAX_RESPONSE_SIZE: raw })).toBe(raw === '1e3' ? 1 : 2048);
  });

  it.each(['0x10', '0', '-1', 'lots'])('uses the default for %p', (raw) => {
    expect(readFetchMaxResponseSize({ FETCH_MAX_RESPONSE_SIZE: raw })).toBe(10_485_760);
  });

  it('rejects both names before the invalid old value can fall back', () => {
    expect(() =>
      readFetchMaxResponseSize({ VERIFY_MAX_CREDENTIAL_SIZE: 'lots', FETCH_MAX_RESPONSE_SIZE: '2048' }),
    ).toThrow(
      'VERIFY_MAX_CREDENTIAL_SIZE and FETCH_MAX_RESPONSE_SIZE are both set. VERIFY_MAX_CREDENTIAL_SIZE was renamed to FETCH_MAX_RESPONSE_SIZE in v0.5. Set FETCH_MAX_RESPONSE_SIZE to the value you intend, remove VERIFY_MAX_CREDENTIAL_SIZE, and restart.',
    );
  });

  it('does not treat equivalent numeric spellings as the same setting', () => {
    expect(() =>
      readFetchMaxResponseSize({ VERIFY_MAX_CREDENTIAL_SIZE: '2048', FETCH_MAX_RESPONSE_SIZE: '02048' }),
    ).toThrow(/both set/);
  });
});

describe('readFetchTimeoutMs', () => {
  it.each([undefined, '', '   '])('uses 10 seconds when the setting is %p', (raw) => {
    expect(readFetchTimeoutMs(raw === undefined ? empty : { FETCH_TIMEOUT_MS: raw })).toBe(10_000);
  });

  it.each(['1', '120000', '3210', '1e3', '0x10', ' 3210 '])('accepts existing timeout input %p', (raw) => {
    expect(readFetchTimeoutMs({ FETCH_TIMEOUT_MS: raw })).toBe(Number(raw));
  });

  it.each(['0', '-1', '1.5', '10s', 'Infinity', 'NaN', '120001'])('rejects invalid timeout %p', (raw) => {
    expect(() => readFetchTimeoutMs({ FETCH_TIMEOUT_MS: raw })).toThrow(
      'FETCH_TIMEOUT_MS must be a positive integer number of milliseconds no greater than 120000 when set; fix or unset it (unset uses 10000).',
    );
  });

  it('names the deprecated timeout input when it is invalid', () => {
    expect(() => readFetchTimeoutMs({ VERIFY_FETCH_TIMEOUT_MS: '1.5' })).toThrow(
      'VERIFY_FETCH_TIMEOUT_MS must be a positive integer number of milliseconds no greater than 120000 when set; fix or unset it (unset uses 10000).',
    );
  });

  it.each([
    ['equal values', '3210', '3210'],
    ['different values', '3210', '4000'],
  ])('rejects %s before parsing', (_label, oldValue, newValue) => {
    expect(() => readFetchTimeoutMs({ VERIFY_FETCH_TIMEOUT_MS: oldValue, FETCH_TIMEOUT_MS: newValue })).toThrow(
      /VERIFY_FETCH_TIMEOUT_MS and FETCH_TIMEOUT_MS are both set/,
    );
  });
});

describe('validateFetchSettingsOnBoot', () => {
  const logger = { warn: jest.fn() };

  beforeEach(() => {
    logger.warn.mockClear();
  });

  it('warns once per old-only setting after every setting validates', () => {
    validateFetchSettingsOnBoot(logger, {
      VERIFY_ALLOW_PRIVATE_URLS: 'false',
      VERIFY_MAX_CREDENTIAL_SIZE: 'lots',
      VERIFY_FETCH_TIMEOUT_MS: '3210',
    });

    expect(logger.warn.mock.calls).toEqual([
      [
        'VERIFY_ALLOW_PRIVATE_URLS was renamed to FETCH_ALLOW_PRIVATE_URLS in v0.5 and will stop being read in v0.6. Rename VERIFY_ALLOW_PRIVATE_URLS to FETCH_ALLOW_PRIVATE_URLS, keeping its value, and restart.',
      ],
      [
        'VERIFY_MAX_CREDENTIAL_SIZE was renamed to FETCH_MAX_RESPONSE_SIZE in v0.5 and will stop being read in v0.6. Rename VERIFY_MAX_CREDENTIAL_SIZE to FETCH_MAX_RESPONSE_SIZE, keeping its value, and restart.',
      ],
      [
        'VERIFY_FETCH_TIMEOUT_MS was renamed to FETCH_TIMEOUT_MS in v0.5 and will stop being read in v0.6. Rename VERIFY_FETCH_TIMEOUT_MS to FETCH_TIMEOUT_MS, keeping its value, and restart.',
      ],
    ]);
  });

  it('does not warn for new-only or blank deprecated input', () => {
    validateFetchSettingsOnBoot(logger, {
      VERIFY_ALLOW_PRIVATE_URLS: ' ',
      FETCH_ALLOW_PRIVATE_URLS: 'true',
      VERIFY_MAX_CREDENTIAL_SIZE: '',
      FETCH_MAX_RESPONSE_SIZE: '2048',
      VERIFY_FETCH_TIMEOUT_MS: '\t',
      FETCH_TIMEOUT_MS: '3210',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('emits no warning when validation fails', () => {
    expect(() =>
      validateFetchSettingsOnBoot(logger, {
        VERIFY_ALLOW_PRIVATE_URLS: 'false',
        FETCH_ALLOW_PRIVATE_URLS: 'true',
        VERIFY_MAX_CREDENTIAL_SIZE: '2048',
      }),
    ).toThrow(/both set/);
    expect(logger.warn).not.toHaveBeenCalled();

    expect(() => validateFetchSettingsOnBoot(logger, { VERIFY_FETCH_TIMEOUT_MS: '1.5' })).toThrow(
      /VERIFY_FETCH_TIMEOUT_MS/,
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns on each independent startup invocation', () => {
    const env = { VERIFY_ALLOW_PRIVATE_URLS: 'false' };
    validateFetchSettingsOnBoot(logger, env);
    validateFetchSettingsOnBoot(logger, env);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe('deriveHarnessAllowPrivateUrls', () => {
  // Each case fails if the harness key stops tracking the application setting:
  // a wrong value silently skips the SSRF specs or sends them down the wrong
  // assertion branch, which no other check would catch.
  it('defaults to true when neither application name is supplied', () => {
    expect(deriveHarnessAllowPrivateUrls({})).toBe(true);
  });

  it('honours the harness-only input when neither application name is supplied', () => {
    expect(deriveHarnessAllowPrivateUrls({ CYPRESS_VERIFY_ALLOW_PRIVATE_URLS: 'false' })).toBe(false);
  });

  it('takes the new application name over the harness-only input', () => {
    expect(
      deriveHarnessAllowPrivateUrls({
        FETCH_ALLOW_PRIVATE_URLS: 'false',
        CYPRESS_VERIFY_ALLOW_PRIVATE_URLS: 'true',
      }),
    ).toBe(false);
  });

  it('takes the deprecated application name when it is the only one supplied', () => {
    expect(deriveHarnessAllowPrivateUrls({ VERIFY_ALLOW_PRIVATE_URLS: 'true' })).toBe(true);
  });

  it('applies the application parser to a padded value rather than trimming it', () => {
    expect(deriveHarnessAllowPrivateUrls({ FETCH_ALLOW_PRIVATE_URLS: ' true ' })).toBe(false);
  });

  it('throws the application conflict when both application names are supplied', () => {
    expect(() =>
      deriveHarnessAllowPrivateUrls({ VERIFY_ALLOW_PRIVATE_URLS: 'true', FETCH_ALLOW_PRIVATE_URLS: 'true' }),
    ).toThrow('VERIFY_ALLOW_PRIVATE_URLS and FETCH_ALLOW_PRIVATE_URLS are both set.');
  });

  it('counts a blank application value as absent and falls back', () => {
    expect(deriveHarnessAllowPrivateUrls({ FETCH_ALLOW_PRIVATE_URLS: '   ' })).toBe(true);
    expect(
      deriveHarnessAllowPrivateUrls({ FETCH_ALLOW_PRIVATE_URLS: '   ', CYPRESS_VERIFY_ALLOW_PRIVATE_URLS: 'false' }),
    ).toBe(false);
  });

  it('returns a boolean, never the raw string', () => {
    expect(typeof deriveHarnessAllowPrivateUrls({ CYPRESS_VERIFY_ALLOW_PRIVATE_URLS: 'true' })).toBe('boolean');
  });
});
