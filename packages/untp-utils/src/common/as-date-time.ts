/**
 * Matches the JSON Schema `date-time` format (RFC 3339 section 5.6).
 *
 * As of UNTP 0.7.0, every data model declares a credential's `validFrom` and
 * `validUntil` as `"type": "string", "format": "date-time"`, and that is what
 * this system validates a payload against before signing it.
 *
 * The W3C VC Data Model 2.0 is looser: it requires only an XML Schema 1.1
 * `dateTime`, which permits an offsetless local time, years outside four
 * digits, and `24:00:00` (https://www.w3.org/TR/vc-data-model-2.0/#validity-period).
 * A credential issued elsewhere may therefore carry a value this rejects, and
 * it is reported as absent rather than guessed: with no timezone there is no
 * way to tell which moment a local time such as `09:00` refers to.
 */
const RFC3339_DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Returns the date and time `value` refers to, when `value` is a well-formed
 * RFC 3339 date-time for a day that exists. Otherwise returns `undefined`.
 *
 * `new Date()` alone is not enough. It accepts loose forms such as `2024-01-15`
 * or `January 15, 2024`, and it quietly normalises an impossible date, turning
 * `2024-02-30` into 1 March, which would report a date the document never
 * asserted.
 *
 * `undefined` rather than `null` because this reports what a document does not
 * usably contain. How to record that absence is the caller's decision.
 */
export function asDateTime(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !RFC3339_DATE_TIME.test(value)) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // Round-trip the calendar day: a normalised day (30 February) lands on a
  // different day-of-month than the string names.
  const day = Number(value.slice(8, 10));
  const offsetMatch = /([+-])(\d{2}):(\d{2})$/.exec(value);
  const offsetMinutes = offsetMatch
    ? (offsetMatch[1] === '-' ? -1 : 1) * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]))
    : 0;
  const local = new Date(parsed.getTime() + offsetMinutes * 60_000);
  return local.getUTCDate() === day ? parsed : undefined;
}
