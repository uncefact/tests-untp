import { isSafeHeaderValue } from './is-safe-header-value.js';

/**
 * `User-Agent` sent on every guarded fetch (`resolveDocument` and
 * everything composed on it) unless overridden.
 *
 * Anonymous (UA-less) automated fetches are challenged by bot protection on
 * well-known context hosts (w3.org's Cloudflare returns 429 challenge pages;
 * observed in production, see uncefact/tests-untp#886), so every request
 * identifies itself. Operators override via the `RI_HTTP_USER_AGENT`
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
 * Whether `value` can be sent as an HTTP `User-Agent` field value: non-blank
 * and free of control characters (notably CR/LF, which would corrupt or
 * split the request's header block).
 *
 * Exported so deployments can validate their configured override at boot
 * (fail-fast) instead of meeting the guarded fetch's request-time fallback.
 */
export function isValidHttpUserAgent(value: string): boolean {
  return value.trim() !== '' && isSafeHeaderValue(value);
}
