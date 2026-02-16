export interface VcConfig {
  vckitApiUrl: string;
  vckitApiKey: string;
}

let cached: VcConfig | null = null;

export function getVcConfig(): VcConfig {
  if (cached) return cached;

  const { VCKIT_API_URL, VCKIT_API_KEY } = process.env;

  const required = { VCKIT_API_URL, VCKIT_API_KEY };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required VC configuration: ${missing.join(', ')}. Set these in your .env file or environment.`,
    );
  }

  cached = {
    vckitApiUrl: VCKIT_API_URL!,
    vckitApiKey: VCKIT_API_KEY!,
  };
  return cached;
}

export function resetVcConfig(): void {
  cached = null;
}
