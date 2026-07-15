/**
 * A fast, non-cryptographic content hash (cyrb53) used to identify artefacts by content (ADR-041).
 *
 * Identity, not security: the playground uses this to dedupe identical uploads and to keep two
 * documents with different content (even the same filename) as separate instances. Collision
 * probability across a handful of loaded artefacts is negligible.
 */
export function hashContent(value: unknown): string {
  const input = JSON.stringify(value) ?? '';
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
