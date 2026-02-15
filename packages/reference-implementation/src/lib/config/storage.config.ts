export interface StorageConfig {
  storageServiceUrl: string;
}

let cached: StorageConfig | null = null;

export function getStorageConfig(): StorageConfig {
  if (cached) return cached;

  const { STORAGE_SERVICE_URL } = process.env;

  if (!STORAGE_SERVICE_URL) {
    throw new Error(
      'Missing required storage configuration: STORAGE_SERVICE_URL. Set this in your .env file or environment.',
    );
  }

  cached = {
    storageServiceUrl: STORAGE_SERVICE_URL,
  };
  return cached;
}

/** Reset cached config (for testing). */
export function resetStorageConfig(): void {
  cached = null;
}
