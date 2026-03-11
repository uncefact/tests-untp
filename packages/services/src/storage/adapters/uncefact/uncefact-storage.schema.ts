import { z } from 'zod';

export const uncefactStorageConfigSchema = z.object({
  baseUrl: z.string().url().describe('Base URL||The base URL of the UNCEFACT storage service (no path segments)'),
  apiKey: z.string().min(1).optional().describe('API Key||The API key for authenticating with the storage service'),
  apiVersion: z.enum(['3.1.0']).default('3.1.0').describe('API Version||The storage API version to use'),
  publicBucket: z
    .string()
    .min(1)
    .describe('Public Bucket||Bucket name for public (unencrypted) storage. Can be the same as privateBucket.'),
  privateBucket: z
    .string()
    .min(1)
    .describe('Private Bucket||Bucket name for private (encrypted) storage. Can be the same as publicBucket.'),
});

export type UncefactStorageConfig = z.infer<typeof uncefactStorageConfigSchema>;

/** Fields whose values should be treated as sensitive (e.g. masked in UI, encrypted at rest). */
export const uncefactStorageSensitiveFields: (keyof UncefactStorageConfig)[] = ['apiKey'];
