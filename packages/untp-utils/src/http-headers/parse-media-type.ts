import { isSafeHeaderValue } from './is-safe-header-value.js';

// RFC 7231 §3.1.1.1: media-type = type "/" subtype *( OWS ";" OWS parameter )
// tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "."
//       / "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
const TOKEN = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+";
const QUOTED = '"[^"]*"';
const PARAM = `\\s*;\\s*${TOKEN}=(?:${TOKEN}|${QUOTED})`;
const MEDIA_TYPE_RE = new RegExp(`^${TOKEN}\\/${TOKEN}(?:${PARAM})*$`);

/**
 * Validates an HTTP `Content-Type` value per RFC 7231 §3.1.1.1. Returns
 * the value verbatim if it matches the media-type grammar (`type/subtype`
 * with optional `; name=value` parameters); otherwise returns `undefined`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc7231#section-3.1.1.1
 */
export function parseMediaType(value: string): string | undefined {
  if (!isSafeHeaderValue(value)) return undefined;
  return MEDIA_TYPE_RE.test(value) ? value : undefined;
}
