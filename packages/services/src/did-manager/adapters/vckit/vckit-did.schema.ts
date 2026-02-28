import { z } from 'zod';

export const vckitDidConfigSchema = z.object({
  endpoint: z
    .string()
    .url()
    .describe('API Endpoint||The base URL of your VCKit instance, e.g. https://vckit.example.com'),
  apiKey: z.string().min(1).describe('API Key||The API key for authenticating with VCKit'),
  apiVersion: z.enum(['1.0.0']).default('1.0.0').describe('API Version||The VCKit API version'),
});

export type VCKitDidConfig = z.infer<typeof vckitDidConfigSchema>;

export const vckitDidSensitiveFields: (keyof VCKitDidConfig)[] = ['apiKey'];
