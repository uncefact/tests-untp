describe('MAX_BATCH_GET_IDS', () => {
  const original = process.env.API_MAX_BATCH_GET_IDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.API_MAX_BATCH_GET_IDS;
    } else {
      process.env.API_MAX_BATCH_GET_IDS = original;
    }
    jest.resetModules();
  });

  it('uses the default maximum of 500 when the variable is absent', async () => {
    delete process.env.API_MAX_BATCH_GET_IDS;

    await jest.isolateModulesAsync(async () => {
      const batchLimits = await import('./batch-limits');
      expect(batchLimits.MAX_BATCH_GET_IDS).toBe(500);
    });
  });

  it('uses a valid operator override', async () => {
    process.env.API_MAX_BATCH_GET_IDS = ' 2 ';

    await jest.isolateModulesAsync(async () => {
      const batchLimits = await import('./batch-limits');
      expect(batchLimits.MAX_BATCH_GET_IDS).toBe(2);
    });
  });
});

describe('warnOnRejectedMaxBatchGetIdsOverride', () => {
  const original = process.env.API_MAX_BATCH_GET_IDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.API_MAX_BATCH_GET_IDS;
    } else {
      process.env.API_MAX_BATCH_GET_IDS = original;
    }
  });

  it.each(['abc', ''])('warns with the variable and applied maximum when the override %j is unusable', async (raw) => {
    process.env.API_MAX_BATCH_GET_IDS = raw;
    const warn = jest.fn();
    const { warnOnRejectedMaxBatchGetIdsOverride } = await import('./batch-limits');

    warnOnRejectedMaxBatchGetIdsOverride({ warn });

    expect(warn).toHaveBeenCalledWith(
      { API_MAX_BATCH_GET_IDS: raw, appliedMaximum: 500 },
      expect.stringContaining('API_MAX_BATCH_GET_IDS'),
    );
    expect(warn.mock.calls[0][1]).toContain('500');
  });

  it('stays silent for a valid or absent override', async () => {
    const warn = jest.fn();
    const { warnOnRejectedMaxBatchGetIdsOverride } = await import('./batch-limits');

    process.env.API_MAX_BATCH_GET_IDS = '2';
    warnOnRejectedMaxBatchGetIdsOverride({ warn });
    delete process.env.API_MAX_BATCH_GET_IDS;
    warnOnRejectedMaxBatchGetIdsOverride({ warn });

    expect(warn).not.toHaveBeenCalled();
  });
});
