import { isSafeHeaderValue } from './is-safe-header-value.js';

// RFC 7231 §7.1.1.1 IMF-fixdate: the only timestamp format servers SHOULD
// generate. RFC 850 and asctime() are receivable per the RFC but
// effectively dead in modern HTTP; this validator rejects them.
const IMF_FIXDATE_RE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Validates an HTTP `Last-Modified` / `If-Modified-Since` / `Date` value
 * per RFC 7231 §7.1.1.1 IMF-fixdate. Returns the value verbatim if it
 * matches the strict IMF-fixdate grammar; otherwise returns `undefined`.
 *
 * Strict by design: only IMF-fixdate is accepted. Servers that send
 * RFC 850 or asctime() format produce `undefined` here. If you hit a
 * real upstream sending a legacy format, broaden this validator with a
 * deliberate test case rather than relaxing it ad hoc.
 *
 * @see https://www.rfc-editor.org/rfc/rfc7231#section-7.1.1.1
 */
export function parseImfDate(value: string): string | undefined {
  if (!isSafeHeaderValue(value)) return undefined;
  return IMF_FIXDATE_RE.test(value) ? value : undefined;
}
