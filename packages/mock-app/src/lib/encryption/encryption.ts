import { AesGcmEncryptionAdapter } from "@uncefact/untp-ri-services/server";

let cached: AesGcmEncryptionAdapter | null = null;

export function getEncryptionService(): AesGcmEncryptionAdapter {
  if (cached) return cached;

  const key = process.env.SERVICE_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "Missing required SERVICE_ENCRYPTION_KEY environment variable. " +
        "Set this in your .env file or environment.",
    );
  }

  cached = new AesGcmEncryptionAdapter(key);
  return cached;
}
