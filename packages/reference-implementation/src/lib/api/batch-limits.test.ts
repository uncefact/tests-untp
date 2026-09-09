describe('MAX_BATCH_LIMIT', () => {
  const original = process.env.API_MAX_BATCH_LIMIT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.API_MAX_BATCH_LIMIT;
    } else {
      process.env.API_MAX_BATCH_LIMIT = original;
    }
    jest.resetModules();
  });

  it('uses the default maximum of 500 when the variable is absent', async () => {
    delete process.env.API_MAX_BATCH_LIMIT;

    await jest.isolateModulesAsync(async () => {
      const batchLimits = await import('./batch-limits');
      expect(batchLimits.MAX_BATCH_LIMIT).toBe(500);
    });
  });

  it('uses a valid operator override', async () => {
    process.env.API_MAX_BATCH_LIMIT = ' 2 ';

    await jest.isolateModulesAsync(async () => {
      const batchLimits = await import('./batch-limits');
      expect(batchLimits.MAX_BATCH_LIMIT).toBe(2);
    });
  });
});

describe('warnOnRejectedMaxBatchLimitOverride', () => {
  const original = process.env.API_MAX_BATCH_LIMIT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.API_MAX_BATCH_LIMIT;
    } else {
      process.env.API_MAX_BATCH_LIMIT = original;
    }
  });

  it.each(['abc', ''])('warns with the variable and applied maximum when the override %j is unusable', async (raw) => {
    process.env.API_MAX_BATCH_LIMIT = raw;
    const warn = jest.fn();
    const { warnOnRejectedMaxBatchLimitOverride } = await import('./batch-limits');

    warnOnRejectedMaxBatchLimitOverride({ warn });

    expect(warn).toHaveBeenCalledWith(
      { API_MAX_BATCH_LIMIT: raw, appliedMaximum: 500 },
      expect.stringContaining('API_MAX_BATCH_LIMIT'),
    );
    expect(warn.mock.calls[0][1]).toContain('500');
  });

  it('stays silent for a valid or absent override', async () => {
    const warn = jest.fn();
    const { warnOnRejectedMaxBatchLimitOverride } = await import('./batch-limits');

    process.env.API_MAX_BATCH_LIMIT = '2';
    warnOnRejectedMaxBatchLimitOverride({ warn });
    delete process.env.API_MAX_BATCH_LIMIT;
    warnOnRejectedMaxBatchLimitOverride({ warn });

    expect(warn).not.toHaveBeenCalled();
  });
});
