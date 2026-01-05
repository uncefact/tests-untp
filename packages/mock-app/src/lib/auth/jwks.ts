/**
 * Keycloak JWKS Client
 *
 * Fetches and caches Keycloak's JSON Web Key Set for JWT validation.
 * Uses jose library's built-in caching mechanism for performance.
 */

import { createRemoteJWKSet } from "jose";

// Cache the JWKS function to avoid recreating on every request
let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedIssuer: string | null = null;

/**
 * Gets the JWKS function for the Keycloak issuer.
 * The jose library handles internal caching of the actual keys.
 */
export function getKeycloakJWKS() {
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER;

  if (!issuer) {
    throw new Error("AUTH_KEYCLOAK_ISSUER environment variable is not set");
  }

  // Recreate if issuer changed (useful for testing)
  if (cachedJWKS && cachedIssuer === issuer) {
    return cachedJWKS;
  }

  // Keycloak's JWKS endpoint follows OIDC standard
  const jwksUrl = new URL(`${issuer}/protocol/openid-connect/certs`);

  cachedJWKS = createRemoteJWKSet(jwksUrl);
  cachedIssuer = issuer;

  return cachedJWKS;
}

/**
 * Clears the cached JWKS function.
 * Useful for testing or when issuer configuration changes.
 */
export function clearJWKSCache(): void {
  cachedJWKS = null;
  cachedIssuer = null;
}
