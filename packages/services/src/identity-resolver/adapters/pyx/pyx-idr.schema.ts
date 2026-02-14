import { z } from 'zod';

export const pyxIdrConfigSchema = z.object({
  baseUrl: z.string().url().describe('Base URL||The base URL of the Pyx IDR instance (no path segments)'),
  apiKey: z.string().min(1).describe('API Key||The API key for authenticating with the Pyx IDR'),
  apiVersion: z.enum(['2.0.2']).default('2.0.2').describe('API Version||The Pyx IDR API version to use'),
  defaultContext: z
    .string()
    .optional()
    .default('au')
    .describe('Default Context||Default regional context for link registrations'),
  defaultFlags: z
    .object({
      defaultLinkType: z.boolean().optional().default(false),
      defaultMimeType: z.boolean().optional().default(false),
      defaultIanaLanguage: z.boolean().optional().default(false),
      defaultContext: z.boolean().optional().default(false),
      fwqs: z.boolean().optional().default(false),
    })
    .optional()
    .describe('Default Flags||Default flag configuration for link registrations'),
});

/** Fields whose values should be treated as sensitive (e.g. masked in UI, encrypted at rest). */
export const pyxIdrSensitiveFields: (keyof PyxIdrConfig)[] = ['apiKey'];

export type PyxIdrConfig = z.infer<typeof pyxIdrConfigSchema>;
