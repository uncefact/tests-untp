export interface DidConfig {
  defaultDid: string;
  defaultKeyId?: string;
}

let cached: DidConfig | null = null;

export function getDidConfig(): DidConfig {
  if (cached) return cached;

  const { SYSTEM_DID, SYSTEM_DID_KEY_ID } = process.env;

  if (!SYSTEM_DID) {
    throw new Error('Missing required DID configuration: SYSTEM_DID. Set this in your .env file or environment.');
  }

  cached = {
    defaultDid: SYSTEM_DID,
    defaultKeyId: SYSTEM_DID_KEY_ID || undefined,
  };
  return cached;
}

/** Reset cached config (for testing). */
export function resetDidConfig(): void {
  cached = null;
}
