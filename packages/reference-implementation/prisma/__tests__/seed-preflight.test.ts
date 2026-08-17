import {
  runSeedPreflight,
  SeedConfigurationError,
  EXECUTION_CATEGORIES,
  ALWAYS_RUN_CATEGORIES,
  buildOutcomeSummary,
  type SeedRunSummary,
  type SummaryCategoryName,
  type CategoryOutcome,
} from '../seed-preflight';

/** A fully configured environment: every category resolves 'ok'. */
function fullEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATA_ENCRYPTION_KEY: 'a-real-key',
    SYSTEM_IDR_BASE_URL: 'https://idr.example.com',
    SYSTEM_IDR_API_KEY: 'idr-key',
    SYSTEM_IDR_DEFAULT_LINK_TYPE: 'untp:dpp',
    SYSTEM_IDR_DEFAULT_MIME_TYPE: 'text/html',
    SYSTEM_IDR_DEFAULT_LANGUAGE: 'en',
    SYSTEM_IDR_DEFAULT_CONTEXT: 'au',
    SYSTEM_STORAGE_BASE_URL: 'https://storage.example.com',
    SYSTEM_STORAGE_PUBLIC_BUCKET: 'public',
    SYSTEM_STORAGE_PRIVATE_BUCKET: 'private',
    SYSTEM_VC_BASE_URL: 'https://vckit.example.com',
    SYSTEM_VC_API_KEY: 'vc-key',
    SYSTEM_DID: 'did:web:example.com',
  };
}

describe('runSeedPreflight', () => {
  it('resolves every category ok against a fully configured environment', () => {
    const result = runSeedPreflight(fullEnv());

    expect(result.hasMissing).toBe(false);
    for (const category of Object.values(result.categories)) {
      expect(category.status).toBe('ok');
    }
    expect(result.missingByCategory).toEqual({});
  });

  it('reports DATA_ENCRYPTION_KEY missing, and gates idr, storage and vc on it', () => {
    const env = fullEnv();
    delete env.DATA_ENCRYPTION_KEY;

    const result = runSeedPreflight(env);

    expect(result.hasMissing).toBe(true);
    expect(result.categories.encryption).toMatchObject({
      status: 'missing',
      missingVars: ['DATA_ENCRYPTION_KEY (or the deprecated SERVICE_ENCRYPTION_KEY)'],
    });
    expect(result.categories.idr).toMatchObject({ status: 'missing', gatedBy: 'encryption' });
    expect(result.categories.storage).toMatchObject({ status: 'missing', gatedBy: 'encryption' });
    expect(result.categories.vc).toMatchObject({ status: 'missing', gatedBy: 'encryption' });
  });

  it('honours SERVICE_ENCRYPTION_KEY as the deprecated alias so encryption still resolves ok', () => {
    const env = fullEnv();
    delete env.DATA_ENCRYPTION_KEY;
    env.SERVICE_ENCRYPTION_KEY = 'a-real-key';

    const result = runSeedPreflight(env);

    expect(result.categories.encryption.status).toBe('ok');
  });

  it('reports each missing IDR variable by its actual environment variable name', () => {
    const env = fullEnv();
    delete env.SYSTEM_IDR_BASE_URL;
    delete env.SYSTEM_IDR_DEFAULT_CONTEXT;

    const result = runSeedPreflight(env);

    expect(result.categories.idr).toMatchObject({ status: 'missing' });
    expect(result.categories.idr.missingVars).toEqual(
      expect.arrayContaining(['SYSTEM_IDR_BASE_URL', 'SYSTEM_IDR_DEFAULT_CONTEXT']),
    );
  });

  it('reports each missing storage variable by its actual environment variable name', () => {
    const env = fullEnv();
    delete env.SYSTEM_STORAGE_PUBLIC_BUCKET;

    const result = runSeedPreflight(env);

    expect(result.categories.storage).toEqual({ status: 'missing', missingVars: ['SYSTEM_STORAGE_PUBLIC_BUCKET'] });
  });

  it('reports each missing VC variable by its actual environment variable name', () => {
    const env = fullEnv();
    delete env.SYSTEM_VC_API_KEY;

    const result = runSeedPreflight(env);

    expect(result.categories.vc).toEqual({ status: 'missing', missingVars: ['SYSTEM_VC_API_KEY'] });
  });

  it('does not treat an optional storage field (apiKey) as missing when absent', () => {
    const env = fullEnv();
    delete env.SYSTEM_STORAGE_API_KEY; // already absent in fullEnv(); explicit for clarity

    const result = runSeedPreflight(env);

    expect(result.categories.storage.status).toBe('ok');
  });

  it('reports SYSTEM_DID missing, independent of whether VC is configured', () => {
    const env = fullEnv();
    delete env.SYSTEM_DID;

    const result = runSeedPreflight(env);

    expect(result.categories.did).toEqual({ status: 'missing', missingVars: ['SYSTEM_DID'] });
  });

  it('gates did on vc: SYSTEM_DID present but VC not configured still reports did as missing', () => {
    const env = fullEnv();
    delete env.SYSTEM_VC_BASE_URL;

    const result = runSeedPreflight(env);

    expect(result.categories.vc.status).toBe('missing');
    expect(result.categories.did).toMatchObject({ status: 'missing', gatedBy: 'vc' });
  });

  it('gates renderTemplates on storage', () => {
    const env = fullEnv();
    delete env.SYSTEM_STORAGE_BASE_URL;

    const result = runSeedPreflight(env);

    expect(result.categories.storage.status).toBe('missing');
    expect(result.categories.renderTemplates).toMatchObject({ status: 'missing', gatedBy: 'storage' });
  });

  it('classifies an unknown IDR adapter type as other, not missing', () => {
    const env = fullEnv();
    env.SYSTEM_IDR_ADAPTER_TYPE = 'NOT_A_REAL_ADAPTER';

    const result = runSeedPreflight(env);

    expect(result.categories.idr.status).toBe('other');
    expect(result.categories.idr.reason).toMatch(/Unknown IDR adapter type/);
    expect(result.hasMissing).toBe(false);
  });

  it('classifies an invalid (present but malformed) value as other, not missing', () => {
    const env = fullEnv();
    env.SYSTEM_VC_BASE_URL = 'not-a-url';

    const result = runSeedPreflight(env);

    expect(result.categories.vc.status).toBe('other');
    expect(result.hasMissing).toBe(false);
  });

  it('a missing required variable always wins as missing, even when another field in the same category is also invalid', () => {
    // ADR-045 decision 2, tightened: a second, independent mistake in the
    // same category (a mistyped SYSTEM_VC_BASE_URL) must never downgrade
    // an absent SYSTEM_VC_API_KEY out of the fail-loud posture. Making a
    // deployment's configuration worse (adding the typo on top of the
    // missing key) must never make validation weaker.
    const env = fullEnv();
    delete env.SYSTEM_VC_API_KEY;
    env.SYSTEM_VC_BASE_URL = 'not-a-url';

    const result = runSeedPreflight(env);

    expect(result.categories.vc).toMatchObject({ status: 'missing', missingVars: ['SYSTEM_VC_API_KEY'] });
    expect(result.hasMissing).toBe(true);
  });

  it('names the invalid sibling value in otherIssuesByCategory, not only the missing variable', () => {
    const env = fullEnv();
    delete env.SYSTEM_VC_API_KEY;
    env.SYSTEM_VC_BASE_URL = 'not-a-url';

    const result = runSeedPreflight(env);

    expect(result.categories.vc.reason).toMatch(/Invalid url/);
    expect(result.otherIssuesByCategory.vc).toMatch(/Invalid url/);
    // A category with only a missing variable and no other problem has no entry here.
    expect(result.otherIssuesByCategory).not.toHaveProperty('encryption');
  });

  it('surfaces a divergent encryption key reason even when the category itself is not "missing"', () => {
    // resolveEncryptionCategory reports divergent DATA_ENCRYPTION_KEY /
    // SERVICE_ENCRYPTION_KEY values as 'other', never 'missing'. An
    // unrelated category that IS missing (here, SYSTEM_VC_API_KEY) must
    // not make that divergence reason disappear from the run's record
    // (Major finding 2 in the panel follow-up: previously the top-level
    // loop only collected a category's reason when that same category was
    // 'missing', so encryption's divergence was silently dropped whenever
    // paired with an unrelated missing variable elsewhere).
    const env = fullEnv();
    env.DATA_ENCRYPTION_KEY = 'key-one';
    env.SERVICE_ENCRYPTION_KEY = 'key-two';
    delete env.SYSTEM_VC_API_KEY;

    const result = runSeedPreflight(env);

    expect(result.categories.encryption.status).toBe('other');
    expect(result.categories.encryption.reason).toMatch(/both set with different values/);
    expect(result.otherIssuesByCategory.encryption).toMatch(/both set with different values/);
    expect(result.hasMissing).toBe(true);
  });

  it('does not abort preflight on a divergent encryption key alone (no other category missing)', () => {
    // hasMissing stays false because 'other' is not the fail-loud status
    // (ADR-045 decision 2); the divergence is still surfaced later, when
    // main() calls resolveDataEncryptionKey() itself.
    const env = fullEnv();
    env.DATA_ENCRYPTION_KEY = 'key-one';
    env.SERVICE_ENCRYPTION_KEY = 'key-two';

    const result = runSeedPreflight(env);

    expect(result.categories.encryption.status).toBe('other');
    expect(result.otherIssuesByCategory.encryption).toMatch(/both set with different values/);
    expect(result.hasMissing).toBe(false);
  });

  it('an unknown adapter type does not mask a missing required variable underneath it', () => {
    // The same rule extended to the early unknown-adapter-type return: a
    // typo in SYSTEM_IDR_ADAPTER_TYPE must not hide that SYSTEM_IDR_BASE_URL
    // was also never set.
    const env = fullEnv();
    env.SYSTEM_IDR_ADAPTER_TYPE = 'NOT_A_REAL_ADAPTER';
    delete env.SYSTEM_IDR_BASE_URL;

    const result = runSeedPreflight(env);

    expect(result.categories.idr).toMatchObject({ status: 'missing', missingVars: ['SYSTEM_IDR_BASE_URL'] });
  });

  it('collects every missing category together in one pass', () => {
    const env = fullEnv();
    delete env.DATA_ENCRYPTION_KEY;
    delete env.SYSTEM_DID;

    const result = runSeedPreflight(env);

    expect(Object.keys(result.missingByCategory).sort()).toEqual(
      ['did', 'encryption', 'idr', 'renderTemplates', 'storage', 'vc'].sort(),
    );
  });

  describe('an empty or whitespace-only value reads as missing, the same as absent', () => {
    it('DATA_ENCRYPTION_KEY set to only whitespace', () => {
      const env = fullEnv();
      env.DATA_ENCRYPTION_KEY = '   ';

      const result = runSeedPreflight(env);

      expect(result.categories.encryption).toMatchObject({ status: 'missing' });
    });

    it('SYSTEM_IDR_BASE_URL set to an empty string', () => {
      const env = fullEnv();
      env.SYSTEM_IDR_BASE_URL = '';

      const result = runSeedPreflight(env);

      expect(result.categories.idr).toMatchObject({ status: 'missing', missingVars: ['SYSTEM_IDR_BASE_URL'] });
    });

    it('SYSTEM_STORAGE_PUBLIC_BUCKET set to whitespace only', () => {
      const env = fullEnv();
      env.SYSTEM_STORAGE_PUBLIC_BUCKET = '  \t ';

      const result = runSeedPreflight(env);

      expect(result.categories.storage).toMatchObject({
        status: 'missing',
        missingVars: ['SYSTEM_STORAGE_PUBLIC_BUCKET'],
      });
    });

    it('SYSTEM_VC_API_KEY set to an empty string', () => {
      const env = fullEnv();
      env.SYSTEM_VC_API_KEY = '';

      const result = runSeedPreflight(env);

      expect(result.categories.vc).toMatchObject({ status: 'missing', missingVars: ['SYSTEM_VC_API_KEY'] });
    });

    it('SYSTEM_DID set to whitespace only', () => {
      const env = fullEnv();
      env.SYSTEM_DID = '   ';

      const result = runSeedPreflight(env);

      expect(result.categories.did).toEqual({ status: 'missing', missingVars: ['SYSTEM_DID'] });
    });
  });
});

describe('buildOutcomeSummary', () => {
  const ALL_CATEGORIES = [...EXECUTION_CATEGORIES, ...ALWAYS_RUN_CATEGORIES] as SummaryCategoryName[];

  /** Every category 'skipped', as a base to override per test. */
  function skippedOutcomes(): Record<SummaryCategoryName, CategoryOutcome> {
    const outcomes = {} as Record<SummaryCategoryName, CategoryOutcome>;
    for (const category of ALL_CATEGORIES) outcomes[category] = 'skipped';
    return outcomes;
  }

  it('buckets a fully successful run: every category (gated and always-run alike) seeded, nothing partial or skipped', () => {
    const outcomes = {} as Record<SummaryCategoryName, CategoryOutcome>;
    for (const category of ALL_CATEGORIES) outcomes[category] = 'seeded';

    const summary = buildOutcomeSummary('default', {}, outcomes, {});

    expect(summary).toEqual({
      mode: 'default',
      categoriesSeeded: ALL_CATEGORIES,
      categoriesPartial: [],
      categoriesSkipped: [],
      categoriesNotRun: [],
      missingVariables: {},
      invalidSiblings: {},
      partialDetails: {},
    });
  });

  it('partial mode: SEED_ALLOW_PARTIAL=true run, eligible categories seeded and gated ones skipped with their variables named', () => {
    const outcomes = skippedOutcomes();
    outcomes.idr = 'seeded';
    outcomes.tenant = 'seeded';
    outcomes.dataModels = 'seeded';

    const summary = buildOutcomeSummary(
      'partial',
      { storage: ['SYSTEM_STORAGE_BASE_URL'], vc: ['SYSTEM_VC_API_KEY'], did: ['SYSTEM_DID'] },
      outcomes,
      {},
    );

    expect(summary.mode).toBe('partial');
    expect(summary.categoriesSeeded.sort()).toEqual(['idr', 'tenant', 'dataModels'].sort());
    expect(summary.categoriesPartial).toEqual([]);
    expect(summary.categoriesSkipped.sort()).toEqual(['storage', 'vc', 'did', 'renderTemplates', 'customSeed'].sort());
    expect(summary.missingVariables).toEqual({
      storage: ['SYSTEM_STORAGE_BASE_URL'],
      vc: ['SYSTEM_VC_API_KEY'],
      did: ['SYSTEM_DID'],
    });
  });

  it('a category that completed only some of its work is reported partial, never folded into seeded, with the specifics named', () => {
    const outcomes = skippedOutcomes();
    outcomes.storage = 'seeded';
    outcomes.renderTemplates = 'partial';

    const summary = buildOutcomeSummary('partial', {}, outcomes, {
      renderTemplates: ['DigitalProductPassport v0.7.0 (template.hbs missing)'],
    });

    expect(summary.categoriesSeeded).toEqual(['storage']);
    expect(summary.categoriesSeeded).not.toContain('renderTemplates');
    expect(summary.categoriesPartial).toEqual(['renderTemplates']);
    expect(summary.partialDetails.renderTemplates).toEqual(['DigitalProductPassport v0.7.0 (template.hbs missing)']);
  });

  it('always-run categories (tenant, dataModels, customSeed) are covered the same way as the gated ones', () => {
    const outcomes = skippedOutcomes();
    outcomes.tenant = 'seeded';
    outcomes.dataModels = 'partial';
    // customSeed left 'skipped': SKIP_CUSTOM_SEED=true is a deliberate choice, not a failure.

    const summary = buildOutcomeSummary('default', {}, outcomes, {});

    expect(summary.categoriesSeeded).toContain('tenant');
    expect(summary.categoriesPartial).toContain('dataModels');
    expect(summary.categoriesSkipped).toContain('customSeed');
  });

  it('failure-mode shape: a mid-run failure with nothing yet completed reports every category skipped', () => {
    const summary = buildOutcomeSummary(
      'default',
      {
        encryption: ['DATA_ENCRYPTION_KEY (or the deprecated SERVICE_ENCRYPTION_KEY)'],
      },
      skippedOutcomes(),
      {},
    );

    expect(summary.categoriesSeeded).toEqual([]);
    expect(summary.categoriesPartial).toEqual([]);
    expect(summary.categoriesSkipped.sort()).toEqual(ALL_CATEGORIES.slice().sort());
    // `categoriesNotRun` is reserved for the default-mode preflight abort,
    // where nothing at all executed; a mid-run failure instead reports
    // through `categoriesSkipped`, since some of the run did happen.
    expect(summary.categoriesNotRun).toEqual([]);
  });

  it('failure-mode shape: a mid-run failure after some categories already completed reports exactly that mix', () => {
    const outcomes = skippedOutcomes();
    outcomes.idr = 'seeded';
    outcomes.storage = 'seeded';
    outcomes.tenant = 'seeded';

    const summary = buildOutcomeSummary('partial', {}, outcomes, {});

    expect(summary.categoriesSeeded.sort()).toEqual(['idr', 'storage', 'tenant'].sort());
    expect(summary.categoriesSkipped.sort()).toEqual(
      ['vc', 'did', 'renderTemplates', 'dataModels', 'customSeed'].sort(),
    );
  });

  it('iterates categories in a stable order regardless of the outcomes object key order', () => {
    const outcomes = {} as Record<SummaryCategoryName, CategoryOutcome>;
    // Deliberately reversed from ALL_CATEGORIES to prove the output order
    // does not depend on insertion order.
    for (const category of [...ALL_CATEGORIES].reverse()) outcomes[category] = 'seeded';

    const summary = buildOutcomeSummary('default', {}, outcomes, {});

    expect(summary.categoriesSeeded).toEqual(ALL_CATEGORIES);
  });

  it('a category the run never reached is reported notRun, distinct from one reached and genuinely skipped', () => {
    // Moderate finding 6: a category still at its default 'skipped'
    // outcome could mean either "the run reached this category and its
    // gate was unmet" or "an earlier, unrelated failure aborted the run
    // before control ever got here". Passing the categories the run
    // actually reached lets the two be told apart.
    const outcomes = skippedOutcomes();
    outcomes.tenant = 'seeded';

    const summary = buildOutcomeSummary('default', {}, outcomes, {}, {}, [
      'vc',
      'did',
      'renderTemplates',
      'dataModels',
      'customSeed',
    ]);

    // idr and storage were reached (their gate was evaluated) but not run.
    expect(summary.categoriesSkipped.sort()).toEqual(['idr', 'storage'].sort());
    expect(summary.categoriesNotRun.sort()).toEqual(
      ['vc', 'did', 'renderTemplates', 'dataModels', 'customSeed'].sort(),
    );
  });

  it('defaults notRun to empty when omitted, so every unresolved category still reports skipped', () => {
    const summary = buildOutcomeSummary('default', {}, skippedOutcomes(), {});
    expect(summary.categoriesNotRun).toEqual([]);
    expect(summary.categoriesSkipped.sort()).toEqual(ALL_CATEGORIES.slice().sort());
  });

  it('threads invalidSiblings through to the summary, defaulting to empty when omitted', () => {
    const withSiblings = buildOutcomeSummary('default', {}, skippedOutcomes(), {}, { vc: 'Invalid url' });
    expect(withSiblings.invalidSiblings).toEqual({ vc: 'Invalid url' });

    const withoutSiblings = buildOutcomeSummary('default', {}, skippedOutcomes(), {});
    expect(withoutSiblings.invalidSiblings).toEqual({});
  });
});

describe('EXECUTION_CATEGORIES', () => {
  it('names the categories the seed executes, excluding the encryption gate', () => {
    expect(EXECUTION_CATEGORIES).toEqual(['idr', 'storage', 'vc', 'did', 'renderTemplates']);
  });
});

describe('SeedConfigurationError', () => {
  it('names every missing variable and its category, and the opt-out, in its message', () => {
    const summary: SeedRunSummary = {
      mode: 'default',
      categoriesSeeded: [],
      categoriesPartial: [],
      categoriesSkipped: [],
      categoriesNotRun: EXECUTION_CATEGORIES,
      missingVariables: {
        encryption: ['DATA_ENCRYPTION_KEY (or the deprecated SERVICE_ENCRYPTION_KEY)'],
        idr: ['DATA_ENCRYPTION_KEY (or the deprecated SERVICE_ENCRYPTION_KEY)'],
      },
      invalidSiblings: {},
      partialDetails: {},
    };

    const error = new SeedConfigurationError(summary);

    expect(error.name).toBe('SeedConfigurationError');
    expect(error.summary).toBe(summary);
    expect(error.message).toMatch(/encryption: DATA_ENCRYPTION_KEY/);
    expect(error.message).toMatch(/idr: DATA_ENCRYPTION_KEY/);
    expect(error.message).toMatch(/SEED_ALLOW_PARTIAL=true/);
  });

  it('also names an invalid sibling value in the same line as the missing variable, not only on a later boot', () => {
    // An operator who fixes only the missing variable, redeploys, and only
    // then discovers a second, unrelated typo has paid for two boot
    // cycles a single message should have covered.
    const summary: SeedRunSummary = {
      mode: 'default',
      categoriesSeeded: [],
      categoriesPartial: [],
      categoriesSkipped: [],
      categoriesNotRun: EXECUTION_CATEGORIES,
      missingVariables: { vc: ['SYSTEM_VC_API_KEY'] },
      invalidSiblings: { vc: 'Invalid url' },
      partialDetails: {},
    };

    const error = new SeedConfigurationError(summary);

    expect(error.message).toMatch(/vc: SYSTEM_VC_API_KEY.*\(also: Invalid url\)/);
  });

  it('does not append an "(also: ...)" suffix for a category with nothing but a missing variable', () => {
    const summary: SeedRunSummary = {
      mode: 'default',
      categoriesSeeded: [],
      categoriesPartial: [],
      categoriesSkipped: [],
      categoriesNotRun: EXECUTION_CATEGORIES,
      missingVariables: { did: ['SYSTEM_DID'] },
      invalidSiblings: {},
      partialDetails: {},
    };

    const error = new SeedConfigurationError(summary);

    expect(error.message).toMatch(/did: SYSTEM_DID$/m);
    expect(error.message).not.toMatch(/also:/);
  });

  it('names a reason that has no missing variable of its own on a standalone line (Major finding 2)', () => {
    // A divergent DATA_ENCRYPTION_KEY / SERVICE_ENCRYPTION_KEY pair
    // classifies 'other', never 'missing', so encryption never appears in
    // missingVariables. Before this fix, the abort message dropped that
    // reason entirely whenever an unrelated category (here, idr) was the
    // one that actually triggered the abort.
    const summary: SeedRunSummary = {
      mode: 'default',
      categoriesSeeded: [],
      categoriesPartial: [],
      categoriesSkipped: [],
      categoriesNotRun: EXECUTION_CATEGORIES,
      missingVariables: { idr: ['SYSTEM_IDR_BASE_URL'] },
      invalidSiblings: {
        encryption: 'DATA_ENCRYPTION_KEY and SERVICE_ENCRYPTION_KEY are both set with different values.',
      },
      partialDetails: {},
    };

    const error = new SeedConfigurationError(summary);

    expect(error.message).toMatch(/idr: SYSTEM_IDR_BASE_URL/);
    expect(error.message).toMatch(/encryption: DATA_ENCRYPTION_KEY and SERVICE_ENCRYPTION_KEY are both set/);
    // Not folded into idr's "(also: ...)" suffix — it is its own category's line.
    expect(error.message).not.toMatch(/idr:.*also:/);
  });
});
