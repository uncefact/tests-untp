import { z } from 'zod';

export const pyxIdrConfigSchema = z.object({
  baseUrl: z.string().url().describe('Base URL||The base URL of the Pyx IDR instance (no path segments)'),
  apiKey: z.string().min(1).describe('API Key||The API key for authenticating with the Pyx IDR'),
  apiVersion: z.enum(['2.0.2']).default('2.0.2').describe('API Version||The Pyx IDR API version to use'),
  ianaLanguage: z.string().min(1).describe('Language||IANA language tag applied to links (e.g., "en")'),
  context: z.string().min(1).describe('Context||Regional/market context (e.g., "au", "us")'),
  defaultLinkType: z
    .string()
    .min(1)
    .describe('Default Link Type||Link relation type to flag as default (e.g., "untp:dpp")'),
  defaultMimeType: z.string().min(1).describe('Default MIME Type||MIME type to flag as default (e.g., "text/html")'),
  defaultIanaLanguage: z.string().min(1).describe('Default Language||Language to flag as default (e.g., "en")'),
  defaultContext: z.string().min(1).describe('Default Context||Regional context to flag as default (e.g., "au")'),
  fwqs: z.boolean().default(false).describe('Forward Query String||Whether to forward query strings to target URLs'),
});

/** Fields whose values should be treated as sensitive (e.g. masked in UI, encrypted at rest). */
export const pyxIdrSensitiveFields: (keyof PyxIdrConfig)[] = ['apiKey'];

export type PyxIdrConfig = z.infer<typeof pyxIdrConfigSchema>;
