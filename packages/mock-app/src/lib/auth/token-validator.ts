/**
 * Service Account Token Validator
 *
 * Validates Bearer tokens issued by the configured IdP (Keycloak).
 * Used for machine-to-machine authentication with the API.
 *
 * Validates:
 * - Token signature (using IdP's JWKS)
 * - Token issuer (must match configured issuer)
 * - Token audience (must include expected audience)
 * - Token expiry (must not be expired)
 */

import * as jose from "jose";

export interface TokenValidationResult {
  valid: boolean;
  payload?: jose.JWTPayload;
  error?: string;
}

/**
 * Get JWKS remote key set
 */
function getJWKS(issuer: string): jose.JWTVerifyGetKey {
  const jwksUri = `${issuer}/protocol/openid-connect/certs`;

  return jose.createRemoteJWKSet(new URL(jwksUri));
}

/**
 * Validates a Bearer token against the configured IdP.
 *
 * @param token - The JWT token to validate (without "Bearer " prefix)
 * @param options - Validation options
 * @returns Validation result with payload if successful
 */
export async function validateServiceAccountToken(
  token: string,
  options?: {
    issuer?: string;
    audience?: string;
  }
): Promise<TokenValidationResult> {
  const issuer = options?.issuer ?? process.env.AUTH_KEYCLOAK_ISSUER;
  const audience = options?.audience ?? process.env.AUTH_KEYCLOAK_SERVICE_ACCOUNT_AUDIENCE;

  if (!issuer) {
    return {
      valid: false,
      error: "IdP issuer not configured",
    };
  }

  try {
    const jwks = getJWKS(issuer);

    const verifyOptions: jose.JWTVerifyOptions = {
      issuer,
    };

    // Only validate audience if configured
    if (audience) {
      verifyOptions.audience = audience;
    }

    const { payload } = await jose.jwtVerify(token, jwks, verifyOptions);

    return {
      valid: true,
      payload,
    };
  } catch (error) {
    if (error instanceof jose.errors.JOSEError) {
      switch (error.code) {
        case "ERR_JWT_EXPIRED":
          return {
            valid: false,
            error: "Token has expired",
          };
        case "ERR_JWT_CLAIM_VALIDATION_FAILED":
          return {
            valid: false,
            error: `Token claim validation failed: ${error.message}`,
          };
        case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
          return {
            valid: false,
            error: "Token signature verification failed",
          };
        case "ERR_JWKS_NO_MATCHING_KEY":
          return {
            valid: false,
            error: "No matching key found in JWKS",
          };
      }
    }

    return {
      valid: false,
      error: error instanceof Error ? error.message : "Token validation failed",
    };
  }
}

/**
 * Extracts the Bearer token from an Authorization header.
 *
 * @param authHeader - The Authorization header value
 * @returns The token without the "Bearer " prefix, or null if invalid
 */
export function extractBearerToken(
  authHeader: string | null
): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}
