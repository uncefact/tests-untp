import { USER_AGENT_ENV_VAR, isValidHttpUserAgent } from '@uncefact/untp-utils/http-headers';

/**
 * RI_HTTP_USER_AGENT overrides the `User-Agent` the guarded fetchers send on
 * every outbound document fetch (JSON-LD contexts, schemas). It is optional;
 * unset or blank means the untp-utils default is used. Validating it at
 * process boot (instrumentation.node.ts) turns a value that cannot be sent
 * as a header into a failed container start instead of a per-request
 * fallback deep in the issuance path.
 */

/**
 * Throws when RI_HTTP_USER_AGENT is set to a value that cannot be sent as an
 * HTTP header field value. Unset and blank values pass: the override is
 * optional and blank is treated as unset (the guarded fetchers fall back to
 * their default). The raw value is deliberately not echoed because an
 * invalid value contains control characters that must not reach logs.
 */
export function validateHttpUserAgentOnBoot(env: NodeJS.ProcessEnv = process.env): void {
  const value = env[USER_AGENT_ENV_VAR];
  if (value === undefined || value.trim() === '') {
    return;
  }
  if (!isValidHttpUserAgent(value)) {
    throw new Error(
      `${USER_AGENT_ENV_VAR} is not a valid HTTP User-Agent value: it must be plain Latin-1 text with no control characters (no newlines or tabs, and no characters such as emoji). Fix or unset it (unset uses the built-in default).`,
    );
  }
}
