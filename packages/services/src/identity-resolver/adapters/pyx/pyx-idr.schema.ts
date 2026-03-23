import { z } from 'zod';

export const pyxIdrConfigSchema = z.object({
  baseUrl: z.string().url().describe('Base URL||The base URL of the Pyx IDR instance (no path segments)'),
  apiKey: z.string().min(1).describe('API Key||The API key for authenticating with the Pyx IDR'),
  apiVersion: z.enum(['3.0.0']).default('3.0.0').describe('API Version||The Pyx IDR API version to use'),
  defaultLinkType: z
    .enum(['untp:dpp', 'untp:dcc', 'untp:dte', 'untp:idr', 'untp:dfr', 'untp:dia', 'untp:cvc'])
    .describe('Default Link Type||Link relation type to flag as default'),
  defaultMimeType: z.string().min(1).describe('Default MIME Type||MIME type to flag as default (e.g., "text/html")'),
  defaultIanaLanguage: z.string().min(1).describe('Default Language||Language to flag as default (e.g., "en")'),
  defaultContext: z.string().min(1).describe('Default Context||Regional context to flag as default (e.g., "au")'),
  defaultFwqs: z
    .boolean()
    .default(false)
    .describe('Forward Query String||Whether to forward query strings to target URLs'),
});

/** Fields whose values should be treated as sensitive (e.g. masked in UI, encrypted at rest). */
export const pyxIdrSensitiveFields: (keyof PyxIdrConfig)[] = ['apiKey'];

export type PyxIdrConfig = z.infer<typeof pyxIdrConfigSchema>;
