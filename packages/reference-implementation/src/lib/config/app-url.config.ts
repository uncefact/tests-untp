/**
 * RI_APP_URL is the Reference Implementation's public base URL. It backs the
 * OIDC post-logout redirect and the default human verification link on
 * published credentials, and the identity-provider documentation lists it as
 * required. Validating it at process boot (instrumentation.node.ts) turns a
 * misconfigured deployment into a failed container start instead of a
 * runtime failure on the first logout or publish (#823).
 */

/**
 * Returns the validated RI_APP_URL as a URL, or throws with a message naming
 * the variable and the constraint it violated. Userinfo is rejected because
 * the base URL is embedded into publicly published verification links.
 */
export function resolveAppUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const base = env.RI_APP_URL;
  if (!base) {
    throw new Error("RI_APP_URL is required. Set it to this deployment's public base URL, e.g. https://ri.example.com");
  }

  let url: URL | undefined;
  try {
    url = new URL(base);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    // The raw value is deliberately not echoed: a malformed URL can carry
    // userinfo (https://user:secret@host:badport) that must not reach logs.
    throw new Error('RI_APP_URL is not a valid http(s) URL.');
  }
  if (url.username || url.password) {
    throw new Error(
      'RI_APP_URL must not contain a username or password; it is embedded into publicly published verification links.',
    );
  }
  return url;
}

/**
 * Builds the verify-page URL from the validated base. Query and fragment are
 * dropped so they cannot land ahead of the appended path segment (e.g.
 * `https://ri/?x=1` must not become `https://ri/?x=1/verify`); a base path is
 * preserved.
 */
export function buildVerifyUrl(appUrl: URL): string {
  const url = new URL(appUrl.toString());
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/verify`;
  return url.toString();
}
