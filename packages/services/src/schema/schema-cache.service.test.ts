import { fetchSchema, clearSchemaCache, getSchemaCache, SchemaFetchError } from './schema-cache.service.js';

const SCHEMA_URL = 'https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/schema.json';
const MOCK_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' };

describe('schema-cache.service', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    clearSchemaCache();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches schema from URL on cache miss', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_SCHEMA,
    });

    const result = await fetchSchema(SCHEMA_URL);

    expect(mockFetch).toHaveBeenCalledWith(SCHEMA_URL);
    expect(result).toEqual(MOCK_SCHEMA);
  });

  it('returns cached schema on cache hit without re-fetching', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_SCHEMA,
    });

    await fetchSchema(SCHEMA_URL);
    const result = await fetchSchema(SCHEMA_URL);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(MOCK_SCHEMA);
  });

  it('re-fetches schema after TTL expires', async () => {
    const updatedSchema = { ...MOCK_SCHEMA, description: 'updated' };
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => MOCK_SCHEMA })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => updatedSchema });

    const nowSpy = jest.spyOn(Date, 'now');
    const baseTime = 1_000_000;

    // First fetch at t=0
    nowSpy.mockReturnValue(baseTime);
    await fetchSchema(SCHEMA_URL);

    // Within TTL — should use cache
    nowSpy.mockReturnValue(baseTime + 3_599_999);
    const cachedResult = await fetchSchema(SCHEMA_URL);
    expect(cachedResult).toEqual(MOCK_SCHEMA);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Past TTL — should re-fetch
    nowSpy.mockReturnValue(baseTime + 3_600_001);
    const freshResult = await fetchSchema(SCHEMA_URL);
    expect(freshResult).toEqual(updatedSchema);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws SchemaFetchError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    await expect(fetchSchema(SCHEMA_URL)).rejects.toThrow(SchemaFetchError);
    await expect(fetchSchema(SCHEMA_URL)).rejects.toThrow(/Failed to fetch schema/);
  });

  it('throws SchemaFetchError on non-200 response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    await expect(fetchSchema(SCHEMA_URL)).rejects.toThrow(SchemaFetchError);
    await expect(fetchSchema(SCHEMA_URL)).rejects.toThrow(/status 404/);
  });

  it('throws SchemaFetchError on invalid JSON response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    await expect(fetchSchema(SCHEMA_URL)).rejects.toThrow(SchemaFetchError);
    await expect(fetchSchema(SCHEMA_URL)).rejects.toThrow(/Invalid JSON/);
  });

  it('deduplicates concurrent fetches for the same URL', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_SCHEMA,
      }),
    );

    const [r1, r2] = await Promise.all([fetchSchema(SCHEMA_URL), fetchSchema(SCHEMA_URL)]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(MOCK_SCHEMA);
    expect(r2).toEqual(MOCK_SCHEMA);
  });

  it('allows retry after a failed in-flight fetch', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => MOCK_SCHEMA });

    await expect(fetchSchema(SCHEMA_URL)).rejects.toThrow(SchemaFetchError);

    const result = await fetchSchema(SCHEMA_URL);
    expect(result).toEqual(MOCK_SCHEMA);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('clears all cached entries', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_SCHEMA,
    });

    await fetchSchema(SCHEMA_URL);
    expect(getSchemaCache().size).toBe(1);

    clearSchemaCache();
    expect(getSchemaCache().size).toBe(0);
  });
});
