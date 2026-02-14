export interface IdrConfig {
  pyxIdrApiUrl: string;
  pyxIdrApiKey: string;
}

let cached: IdrConfig | null = null;

export function getIdrConfig(): IdrConfig {
  if (cached) return cached;

  const { PYX_IDR_API_URL, PYX_IDR_API_KEY } = process.env;

  const required = { PYX_IDR_API_URL, PYX_IDR_API_KEY };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required IDR configuration: ${missing.join(', ')}. Set these in your .env file or environment.`,
    );
  }

  cached = {
    pyxIdrApiUrl: PYX_IDR_API_URL!,
    pyxIdrApiKey: PYX_IDR_API_KEY!,
  };
  return cached;
}

/** Reset cached config (for testing). */
export function resetIdrConfig(): void {
  cached = null;
}
