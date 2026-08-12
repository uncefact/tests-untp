import { isSafeHeaderValue } from './is-safe-header-value.js';

/**
 * `User-Agent` sent on every guarded fetch (`resolveDocument` and
 * everything composed on it) unless overridden.
 *
 * Anonymous (UA-less) automated fetches risk being challenged by bot
 * protection on well-known context hosts (observed 2026-08-12 on a
 * production RI: w3.org returned 429 challenge pages to UA-less fetches
 * while identified requests from the same host passed), so every request
 * identifies itself. See uncefact/tests-untp#886 for the fetch-per-issuance
 * pattern that provoked it. Operators override via the `RI_HTTP_USER_AGENT`
 * environment variable (read per request, so it applies without a rebuild),
 * and a caller-supplied `user-agent` header takes precedence over both.
 *
 * These live in `http-headers` (not `resolvers`) so boot-time validation can
 * import them in environments that cannot load the resolver stack's undici
 * dependency (e.g. jsdom test environments).
 */
export const DEFAULT_USER_AGENT = 'uncefact-untp-utils (+https://github.com/uncefact/tests-untp)';

/** Environment variable that overrides {@link DEFAULT_USER_AGENT}. */
export const USER_AGENT_ENV_VAR = 'RI_HTTP_USER_AGENT';

/**
 * Whether `value` can be sent as an HTTP `User-Agent` field value: non-blank,
 * free of control characters (notably CR/LF, which would corrupt or split
 * the request's header block; HTAB is also rejected, deliberately stricter
 * than the wire grammar), and within the fetch ByteString range. undici
 * converts header values to ByteString and throws on any UTF-16 code unit
 * above U+00FF (undici@6.25.0 `lib/web/fetch/webidl.js`), so a value the
 * ByteString check fails here would otherwise pass boot validation and then
 * break every guarded fetch at request time. Latin-1 text (e.g. `café`)
 * remains sendable and accepted.
 *
 * Exported so deployments can validate their configured override at boot
 * (fail-fast) instead of meeting the guarded fetch's request-time failure.
 */
export function isValidHttpUserAgent(value: string): boolean {
  if (value.trim() === '' || !isSafeHeaderValue(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0xff) return false;
  }
  return true;
}
