import {
  readDefaultStatusPurposes,
  readStatusMultiplePurposesEnabled,
  validateStatusSettingsOnBoot,
} from './credential-status.config';

describe('readDefaultStatusPurposes', () => {
  it.each([undefined, '', '   '])('uses revocation when CREDENTIAL_STATUS_DEFAULT_PURPOSES is %p', (raw) => {
    // Catches a regression that makes an absent or blank deployment change the existing issuance bytes.
    expect(readDefaultStatusPurposes(raw === undefined ? {} : { CREDENTIAL_STATUS_DEFAULT_PURPOSES: raw })).toEqual([
      'revocation',
    ]);
  });

  it('reads one configured purpose', () => {
    // Catches a regression that ignores a valid deployment setting.
    expect(readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'suspension' })).toEqual(['suspension']);
  });

  it.each(['none', 'NONE'])('uses no status purposes when CREDENTIAL_STATUS_DEFAULT_PURPOSES is %s', (raw) => {
    // Catches a regression that treats the explicit no-status deployment choice as the revocation default.
    expect(readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: raw })).toEqual([]);
  });

  it('rejects none when it is combined with another purpose', () => {
    // Catches a regression that silently accepts an ambiguous deployment setting.
    expect(() => readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'none,revocation' })).toThrow(
      'none must be the only value',
    );
  });

  it('trims two configured purposes and preserves their order', () => {
    // Catches a regression that passes whitespace or reorders the provider input.
    expect(readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: ' revocation, suspension ' })).toEqual([
      'revocation',
      'suspension',
    ]);
  });

  it('ignores empty comma-separated items', () => {
    // Catches a regression that rejects harmless separator whitespace instead of applying the documented parser.
    expect(readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'revocation,, ,suspension' })).toEqual([
      'revocation',
      'suspension',
    ]);
  });

  it('rejects duplicate purposes and names the raw setting and accepted values', () => {
    // Catches a regression that lets duplicate status entries reach the adapter.
    expect(() => readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'revocation,revocation' })).toThrow(
      'CREDENTIAL_STATUS_DEFAULT_PURPOSES has invalid value "revocation,revocation"',
    );
    expect(() => readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'revocation,revocation' })).toThrow(
      'Accepted values: revocation, suspension.',
    );
  });

  it('rejects an unknown purpose and names the offending value', () => {
    // Catches a regression that expands the deployment contract without adapter support.
    expect(() => readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'message' })).toThrow(
      'CREDENTIAL_STATUS_DEFAULT_PURPOSES has invalid value "message"',
    );
    expect(() => readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'message' })).toThrow(
      'Accepted values: revocation, suspension.',
    );
  });

  it('rejects a list containing no purposes after empty items are ignored', () => {
    // Catches a regression that permits an empty status-purpose list to reach signing.
    expect(() => readDefaultStatusPurposes({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: ', , ' })).toThrow(
      'CREDENTIAL_STATUS_DEFAULT_PURPOSES has invalid value ", , "',
    );
  });
});

describe('validateStatusSettingsOnBoot', () => {
  it('accepts the built-in and configured defaults', () => {
    // Catches a regression that rejects a valid deployment during startup.
    expect(() => validateStatusSettingsOnBoot({})).not.toThrow();
    expect(() => validateStatusSettingsOnBoot({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'suspension' })).not.toThrow();
  });

  it('fails startup validation for an unsupported purpose', () => {
    // Catches a regression that defers a bad deployment setting until issuance.
    expect(() => validateStatusSettingsOnBoot({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'message' })).toThrow(
      /CREDENTIAL_STATUS_DEFAULT_PURPOSES.*message.*Accepted values: revocation, suspension/,
    );
  });

  it.each([undefined, '', 'false'])('defaults multi-purpose issuance to disabled for %p', (raw) => {
    expect(
      readStatusMultiplePurposesEnabled(raw === undefined ? {} : { CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED: raw }),
    ).toBe(false);
  });

  it('reads the explicit multi-purpose issuance opt-in', () => {
    expect(readStatusMultiplePurposesEnabled({ CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED: 'true' })).toBe(true);
  });

  it('rejects an ambiguous multi-purpose issuance value', () => {
    expect(() => readStatusMultiplePurposesEnabled({ CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED: 'TRUE' })).toThrow(
      'CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED',
    );
  });

  it('refuses a multi-purpose default while the opt-in is disabled', () => {
    expect(() => validateStatusSettingsOnBoot({ CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'revocation,suspension' })).toThrow(
      'CREDENTIAL_STATUS_DEFAULT_PURPOSES names more than one purpose, but CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED is false. UNTP v0.7.0 schemas accept one credentialStatus object',
    );
  });

  it('accepts a multi-purpose default when the opt-in is enabled', () => {
    expect(() =>
      validateStatusSettingsOnBoot({
        CREDENTIAL_STATUS_DEFAULT_PURPOSES: 'revocation,suspension',
        CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED: 'true',
      }),
    ).not.toThrow();
  });
});

describe('status operation durations', () => {
  const { readStatusOperationBudgetMs, readStatusReconcileGraceMs } =
    jest.requireActual<typeof import('./credential-status.config')>('./credential-status.config');
  it('uses separate operation and grace defaults and reads configured milliseconds', () => {
    expect(readStatusOperationBudgetMs({})).toBe(30_000);
    expect(readStatusReconcileGraceMs({})).toBe(5_000);
    expect(readStatusOperationBudgetMs({ CREDENTIAL_STATUS_OPERATION_BUDGET_MS: ' 12000 ' })).toBe(12_000);
    expect(readStatusReconcileGraceMs({ CREDENTIAL_STATUS_RECONCILE_GRACE_MS: '10' })).toBe(10);
  });
  it.each(['0', '-1', '1.5', '2000ms', '1e3', '2147483648'])(
    'fails boot for unsafe or malformed duration %s',
    (value) => {
      expect(() => validateStatusSettingsOnBoot({ CREDENTIAL_STATUS_OPERATION_BUDGET_MS: value })).toThrow(
        'CREDENTIAL_STATUS_OPERATION_BUDGET_MS',
      );
      expect(() => validateStatusSettingsOnBoot({ CREDENTIAL_STATUS_RECONCILE_GRACE_MS: value })).toThrow(
        'CREDENTIAL_STATUS_RECONCILE_GRACE_MS',
      );
    },
  );
  it('refuses an ambiguous mutation enablement value', () => {
    expect(() => validateStatusSettingsOnBoot({ CREDENTIAL_STATUS_MUTATION_ENABLED: 'TRUE' })).toThrow(
      'CREDENTIAL_STATUS_MUTATION_ENABLED',
    );
    expect(() => validateStatusSettingsOnBoot({ CREDENTIAL_STATUS_MUTATION_ENABLED: 'true' })).not.toThrow();
    expect(() => validateStatusSettingsOnBoot({ CREDENTIAL_STATUS_MUTATION_ENABLED: 'false' })).not.toThrow();
  });
});
