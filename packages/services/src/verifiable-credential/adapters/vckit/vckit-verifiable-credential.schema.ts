import { z } from 'zod';

export const vckitVerifiableCredentialConfigSchema = z.object({
  endpoint: z
    .string()
    .url()
    .describe('API Endpoint||The base URL of your VCKit instance, e.g. https://vckit.example.com'),
  apiKey: z.string().min(1).describe('API Key||The API key for authenticating with VCKit'),
});

export type VCKitVerifiableCredentialConfig = z.infer<typeof vckitVerifiableCredentialConfigSchema>;

export const vckitVerifiableCredentialSensitiveFields: (keyof VCKitVerifiableCredentialConfig)[] = ['apiKey'];
