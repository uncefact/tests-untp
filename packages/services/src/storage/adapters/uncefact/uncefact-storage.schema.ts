import { z } from 'zod';

export const uncefactStorageConfigSchema = z.object({
  baseUrl: z.string().url().describe('Base URL||The base URL of the UNCEFACT storage service (no path segments)'),
  apiKey: z.string().min(1).optional().describe('API Key||The API key for authenticating with the storage service'),
  apiVersion: z.enum(['1.0.0']).default('1.0.0').describe('API Version||The storage API version to use'),
  bucket: z.string().min(1).describe('Bucket||The storage bucket name for storing credentials'),
});

export type UncefactStorageConfig = z.infer<typeof uncefactStorageConfigSchema>;

export const uncefactStorageSensitiveFields = ['apiKey'] as const;
