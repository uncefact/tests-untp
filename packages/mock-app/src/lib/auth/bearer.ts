/**
 * Bearer Token Validation
 *
 * Validates Bearer tokens from Authorization header against Keycloak JWKS.
 * Designed for Edge runtime compatibility.
 */

import { jwtVerify, JWTPayload } from "jose";
import { getKeycloakJWKS } from "./jwks";

/**
 * Result of Bearer token validation
 */
export type BearerValidationResult =
  | { valid: true; payload: JWTPayload }
  | { valid: false; error: string };

/**
 * Extracts Bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Validates a Bearer token against Keycloak JWKS
 *
 * Performs the following validations:
 * - JWT signature verification using Keycloak's public keys
 * - Token expiration (exp claim)
 * - Issuer validation (iss claim must match Keycloak issuer)
 */
export async function validateBearerToken(
  token: string
): Promise<BearerValidationResult> {
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER;

  if (!issuer) {
    return { valid: false, error: "Server configuration error" };
  }

  try {
    const jwks = getKeycloakJWKS();

    const { payload } = await jwtVerify(token, jwks, {
      issuer: issuer,
    });

    return { valid: true, payload };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("expired")) {
        return { valid: false, error: "Token expired" };
      }
      if (error.message.includes("signature")) {
        return { valid: false, error: "Invalid token signature" };
      }
      if (error.message.includes("issuer")) {
        return { valid: false, error: "Invalid token issuer" };
      }
    }

    return { valid: false, error: "Invalid token" };
  }
}
