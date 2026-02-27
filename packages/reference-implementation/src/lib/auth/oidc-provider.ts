import Keycloak from 'next-auth/providers/keycloak';
import Zitadel from 'next-auth/providers/zitadel';

/**
 * Returns the configured OIDC provider for NextAuth.
 *
 * Reads AUTH_OIDC_PROVIDER from the environment (defaults to 'keycloak')
 * and returns the corresponding NextAuth provider instance configured
 * with the shared AUTH_OIDC_* environment variables.
 */
export function getOidcProvider() {
  const provider = process.env.AUTH_OIDC_PROVIDER ?? 'keycloak';
  const issuer = process.env.AUTH_OIDC_ISSUER;
  const clientId = process.env.AUTH_OIDC_CLIENT_ID;
  const clientSecret = process.env.AUTH_OIDC_CLIENT_SECRET;

  if (!issuer || !clientId || !clientSecret) {
    throw new Error('AUTH_OIDC_ISSUER, AUTH_OIDC_CLIENT_ID, and AUTH_OIDC_CLIENT_SECRET must all be set');
  }

  // When the OIDC issuer hostname is only reachable from within Docker,
  // allow overriding the browser-facing authorisation URL separately.
  const authorizationOverride = process.env.AUTH_OIDC_AUTHORIZATION_URL
    ? { authorization: { url: process.env.AUTH_OIDC_AUTHORIZATION_URL } }
    : {};

  switch (provider) {
    case 'keycloak':
      return Keycloak({ issuer, clientId, clientSecret, ...authorizationOverride });

    case 'zitadel':
      return Zitadel({ issuer, clientId, clientSecret, ...authorizationOverride });

    default:
      throw new Error(`Unsupported IdP provider: '${provider}'`);
  }
}
