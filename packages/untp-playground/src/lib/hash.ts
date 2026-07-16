/**
 * A fast, non-cryptographic content hash (cyrb53) used to identify artefacts by content (ADR-041).
 *
 * Identity, not security: the playground uses this to dedupe identical uploads and to keep two
 * documents with different content (even the same filename) as separate instances. Collision
 * probability across a handful of loaded artefacts is negligible.
 */

/**
 * Deterministic JSON with recursively key-sorted objects, so the same document hashes identically
 * regardless of the key order a parser or exporter happened to produce. `undefined` members are
 * omitted, matching `JSON.stringify`.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? '';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .map((key) => (record[key] === undefined ? '' : `${JSON.stringify(key)}:${stableStringify(record[key])}`))
    .filter((member) => member.length > 0);
  return `{${members.join(',')}}`;
}

export function hashContent(value: unknown): string {
  const input = stableStringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
