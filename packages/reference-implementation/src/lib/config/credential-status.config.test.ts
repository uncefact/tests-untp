import { readDefaultStatusPurposes, validateStatusSettingsOnBoot } from './credential-status.config';

describe('readDefaultStatusPurposes', () => {
  it.each([undefined, '', '   '])('uses revocation when DEFAULT_STATUS_PURPOSES is %p', (raw) => {
    // Catches a regression that makes an absent or blank deployment change the existing issuance bytes.
    expect(readDefaultStatusPurposes(raw === undefined ? {} : { DEFAULT_STATUS_PURPOSES: raw })).toEqual([
      'revocation',
    ]);
  });

  it('reads one configured purpose', () => {
    // Catches a regression that ignores a valid deployment setting.
    expect(readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: 'suspension' })).toEqual(['suspension']);
  });

  it.each(['none', 'NONE'])('uses no status purposes when DEFAULT_STATUS_PURPOSES is %s', (raw) => {
    // Catches a regression that treats the explicit no-status deployment choice as the revocation default.
    expect(readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: raw })).toEqual([]);
  });

  it('rejects none when it is combined with another purpose', () => {
    // Catches a regression that silently accepts an ambiguous deployment setting.
    expect(() => readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: 'none,revocation' })).toThrow(
      'none must be the only value',
    );
  });

  it('trims two configured purposes and preserves their order', () => {
    // Catches a regression that passes whitespace or reorders the provider input.
    expect(readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: ' revocation, suspension ' })).toEqual([
      'revocation',
      'suspension',
    ]);
  });

  it('ignores empty comma-separated items', () => {
    // Catches a regression that rejects harmless separator whitespace instead of applying the documented parser.
    expect(readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: 'revocation,, ,suspension' })).toEqual([
      'revocation',
      'suspension',
    ]);
  });

  it('rejects duplicate purposes and names the raw setting and accepted values', () => {
    // Catches a regression that lets duplicate status entries reach the adapter.
    expect(() => readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: 'revocation,revocation' })).toThrow(
      'DEFAULT_STATUS_PURPOSES has invalid value "revocation,revocation"',
    );
    expect(() => readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: 'revocation,revocation' })).toThrow(
      'Accepted values: revocation, suspension.',
    );
  });

  it('rejects an unknown purpose and names the offending value', () => {
    // Catches a regression that expands the deployment contract without adapter support.
    expect(() => readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: 'message' })).toThrow(
      'DEFAULT_STATUS_PURPOSES has invalid value "message"',
    );
    expect(() => readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: 'message' })).toThrow(
      'Accepted values: revocation, suspension.',
    );
  });

  it('rejects a list containing no purposes after empty items are ignored', () => {
    // Catches a regression that permits an empty status-purpose list to reach signing.
    expect(() => readDefaultStatusPurposes({ DEFAULT_STATUS_PURPOSES: ', , ' })).toThrow(
      'DEFAULT_STATUS_PURPOSES has invalid value ", , "',
    );
  });
});

describe('validateStatusSettingsOnBoot', () => {
  it('accepts the built-in and configured defaults', () => {
    // Catches a regression that rejects a valid deployment during startup.
    expect(() => validateStatusSettingsOnBoot({})).not.toThrow();
    expect(() => validateStatusSettingsOnBoot({ DEFAULT_STATUS_PURPOSES: 'suspension' })).not.toThrow();
  });

  it('fails startup validation for an unsupported purpose', () => {
    // Catches a regression that defers a bad deployment setting until issuance.
    expect(() => validateStatusSettingsOnBoot({ DEFAULT_STATUS_PURPOSES: 'message' })).toThrow(
      /DEFAULT_STATUS_PURPOSES.*message.*Accepted values: revocation, suspension/,
    );
  });
});

describe('status operation durations', () => {
  const { readStatusOperationBudgetMs, readStatusReconcileGraceMs } =
    jest.requireActual<typeof import('./credential-status.config')>('./credential-status.config');
  it('uses separate operation and grace defaults and reads configured milliseconds', () => {
    expect(readStatusOperationBudgetMs({})).toBe(30_000);
    expect(readStatusReconcileGraceMs({})).toBe(5_000);
    expect(readStatusOperationBudgetMs({ STATUS_OPERATION_BUDGET_MS: ' 12000 ' })).toBe(12_000);
    expect(readStatusReconcileGraceMs({ STATUS_RECONCILE_GRACE_MS: '10' })).toBe(10);
  });
  it.each(['0', '-1', '1.5', '2000ms', '1e3', '2147483648'])(
    'fails boot for unsafe or malformed duration %s',
    (value) => {
      expect(() => validateStatusSettingsOnBoot({ STATUS_OPERATION_BUDGET_MS: value })).toThrow(
        'STATUS_OPERATION_BUDGET_MS',
      );
      expect(() => validateStatusSettingsOnBoot({ STATUS_RECONCILE_GRACE_MS: value })).toThrow(
        'STATUS_RECONCILE_GRACE_MS',
      );
    },
  );
  it('refuses an ambiguous mutation enablement value', () => {
    expect(() => validateStatusSettingsOnBoot({ STATUS_MUTATION_ENABLED: 'TRUE' })).toThrow('STATUS_MUTATION_ENABLED');
    expect(() => validateStatusSettingsOnBoot({ STATUS_MUTATION_ENABLED: 'true' })).not.toThrow();
    expect(() => validateStatusSettingsOnBoot({ STATUS_MUTATION_ENABLED: 'false' })).not.toThrow();
  });
});
