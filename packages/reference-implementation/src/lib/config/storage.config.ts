export interface StorageConfig {
  storageServiceUrl: string;
}

let cached: StorageConfig | null = null;

export function getStorageConfig(): StorageConfig {
  if (cached) return cached;

  const { UNCEFACT_STORAGE_URL } = process.env;

  if (!UNCEFACT_STORAGE_URL) {
    throw new Error(
      'Missing required storage configuration: UNCEFACT_STORAGE_URL. Set this in your .env file or environment.',
    );
  }

  cached = {
    storageServiceUrl: UNCEFACT_STORAGE_URL,
  };
  return cached;
}

/** Reset cached config (for testing). */
export function resetStorageConfig(): void {
  cached = null;
}
