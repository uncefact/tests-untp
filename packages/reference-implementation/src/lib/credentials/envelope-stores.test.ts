import { classifyNonEnvelope, eachPage, ENVELOPE_STORE_IDS, ENVELOPE_STORE_INFO, perStore } from './envelope-stores';

describe('envelope stores (the port)', () => {
  it('walks service instance configurations first, and names every store distinctly', () => {
    expect(ENVELOPE_STORE_IDS[0]).toBe('serviceInstances');
    expect(new Set(ENVELOPE_STORE_IDS).size).toBe(ENVELOPE_STORE_IDS.length);
    const headings = ENVELOPE_STORE_IDS.map((id) => ENVELOPE_STORE_INFO[id].heading);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it('allows legacy plaintext only for native credential keys', () => {
    expect(ENVELOPE_STORE_IDS.filter((id) => ENVELOPE_STORE_INFO[id].plaintextAllowed)).toEqual(['credentials']);
  });

  it('treats only replay bodies as discardable, and gives every discardable store a remedy', () => {
    const discardable = ENVELOPE_STORE_IDS.filter((id) => ENVELOPE_STORE_INFO[id].discardable);
    expect(discardable).toEqual(['idempotencyResponses']);
    for (const id of ENVELOPE_STORE_IDS) {
      expect(ENVELOPE_STORE_INFO[id].remedy !== undefined).toBe(ENVELOPE_STORE_INFO[id].discardable);
    }
  });

  describe('classifyNonEnvelope', () => {
    it('calls any non-envelope value corruption where plaintext is never written', () => {
      expect(classifyNonEnvelope('serviceInstances', 'plain text')).toBe('corrupted');
      expect(classifyNonEnvelope('idempotencyResponses', '{"cipherText":"truncated')).toBe('corrupted');
    });

    it('tells a damaged envelope from legacy plaintext where plaintext is allowed', () => {
      expect(classifyNonEnvelope('credentials', '{"cipherText":"truncated')).toBe('suspect');
      expect(classifyNonEnvelope('credentials', 'b'.repeat(64))).toBe('plaintext');
    });
  });

  it('builds one value per store, in walk order', () => {
    const built = perStore((id, info) => `${id}:${info.rowName}`);
    expect(Object.keys(built)).toEqual([...ENVELOPE_STORE_IDS]);
    expect(built.credentials).toBe('credentials:credential');
  });

  describe('eachPage', () => {
    it('follows the cursor from the last id of each page, skips null values, and stops on an empty page', async () => {
      const rows = Array.from({ length: 250 }, (_, i) => ({
        id: `row-${String(i).padStart(3, '0')}`,
        value: i % 50 === 0 ? null : `v${i}`,
      }));
      const fetch = jest.fn(async (cursor: string | undefined) =>
        rows.filter((row) => (cursor === undefined ? true : row.id > cursor)).slice(0, 100),
      );

      const seen: string[] = [];
      for await (const row of eachPage(fetch)) seen.push(row.id);

      expect(seen).toHaveLength(245);
      expect(seen).toEqual([...seen].sort());
      expect(fetch.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, 'row-099', 'row-199', 'row-249']);
    });

    it('advances the cursor from the last fetched row even when that row was skipped as null', async () => {
      // A page whose final row is null distinguishes "cursor from the last
      // fetched row" from "cursor from the last yielded row": the latter
      // would refetch the same page forever.
      const rows = Array.from({ length: 150 }, (_, i) => ({
        id: `row-${String(i).padStart(3, '0')}`,
        value: i === 99 || i === 149 ? null : `v${i}`,
      }));
      const fetch = jest.fn(async (cursor: string | undefined) =>
        rows.filter((row) => (cursor === undefined ? true : row.id > cursor)).slice(0, 100),
      );

      const seen: string[] = [];
      for await (const row of eachPage(fetch)) seen.push(row.id);

      expect(seen).toHaveLength(148);
      expect(fetch.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, 'row-099', 'row-149']);
    });
  });
});
