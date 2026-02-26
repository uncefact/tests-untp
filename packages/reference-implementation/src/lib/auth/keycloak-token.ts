import { createLogger } from '@uncefact/untp-ri-services/logging';

const logger = createLogger().child({ module: 'keycloak-token' });

const REFRESH_TIMEOUT_MS = 5000;

export interface RefreshedToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

export async function refreshKeycloakToken(refreshToken: string): Promise<RefreshedToken> {
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER;
  const clientId = process.env.AUTH_KEYCLOAK_CLIENT_ID;
  const clientSecret = process.env.AUTH_KEYCLOAK_CLIENT_SECRET;

  const tokenUrl = `${issuer}/protocol/openid-connect/token`;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId!,
    client_secret: clientSecret!,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Token refresh failed');
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 300),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function decodeAccessToken(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    logger.warn('Failed to decode access token payload');
    return {};
  }
}
