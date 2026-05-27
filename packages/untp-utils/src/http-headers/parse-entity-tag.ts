import { isSafeHeaderValue } from './is-safe-header-value.js';

// RFC 7232 §2.3: entity-tag = [ weak ] DQUOTE *etagc DQUOTE
// weak = "W/"; etagc = %x21 / %x23-7E (printable ASCII except DQUOTE).
const ETAG_RE = /^(?:W\/)?"[!#-~]*"$/;

/**
 * Validates an HTTP `ETag` header value per RFC 7232 §2.3. Returns the
 * value verbatim if it matches the entity-tag grammar (optional `W/`
 * weak prefix, then a double-quoted opaque-tag of printable ASCII);
 * otherwise returns `undefined`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc7232#section-2.3
 */
export function parseEntityTag(value: string): string | undefined {
  if (!isSafeHeaderValue(value)) return undefined;
  return ETAG_RE.test(value) ? value : undefined;
}
