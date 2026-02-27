export interface OidcEndpoints {
  jwks_uri: string;
  token_endpoint: string;
  end_session_endpoint: string;
}

/**
 * Module-level cache is safe because Next.js standalone runs as a single process.
 * The cache is never invalidated — a process restart is required if the OIDC
 * provider's discovery document changes. clearOidcCache() is exposed for testing.
 */
let cachedEndpoints: OidcEndpoints | null = null;

export async function getOidcEndpoints(): Promise<OidcEndpoints> {
  if (cachedEndpoints) {
    return cachedEndpoints;
  }

  const issuerRaw = process.env.AUTH_OIDC_ISSUER;
  if (!issuerRaw) {
    throw new Error('AUTH_OIDC_ISSUER environment variable is not set');
  }

  const issuer = issuerRaw.replace(/\/+$/, '');

  const response = await fetch(`${issuer}/.well-known/openid-configuration`);

  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status} ${response.statusText}`);
  }

  const config = await response.json();

  if (!config.jwks_uri || !config.token_endpoint) {
    throw new Error(
      'OIDC discovery response missing required fields: ' +
        `jwks_uri=${config.jwks_uri ? 'present' : 'MISSING'}, ` +
        `token_endpoint=${config.token_endpoint ? 'present' : 'MISSING'}`,
    );
  }

  cachedEndpoints = {
    jwks_uri: config.jwks_uri,
    token_endpoint: config.token_endpoint,
    end_session_endpoint: config.end_session_endpoint,
  };

  return cachedEndpoints;
}

export function clearOidcCache(): void {
  cachedEndpoints = null;
}
