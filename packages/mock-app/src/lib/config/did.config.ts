export interface DidConfig {
  vckitApiUrl: string;
  vckitAuthToken: string;
  defaultDid: string;
}

let cached: DidConfig | null = null;

export function getDidConfig(): DidConfig {
  if (cached) return cached;

  const { VCKIT_API_URL, VCKIT_AUTH_TOKEN, DEFAULT_ISSUER_DID } = process.env;

  const required = { VCKIT_API_URL, VCKIT_AUTH_TOKEN, DEFAULT_ISSUER_DID };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required DID configuration: ${missing.join(", ")}. ` +
      `Set these in your .env file or environment.`
    );
  }

  cached = {
    vckitApiUrl: VCKIT_API_URL!,
    vckitAuthToken: VCKIT_AUTH_TOKEN!,
    defaultDid: DEFAULT_ISSUER_DID!,
  };
  return cached;
}

/** Reset cached config (for testing). */
export function resetDidConfig(): void {
  cached = null;
}
