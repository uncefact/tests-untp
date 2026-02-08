import { z } from 'zod';

export const vckitDidConfigSchema = z.object({
  endpoint: z.string()
    .url()
    .describe('API Endpoint||The base URL of your VCKit instance, e.g. https://vckit.example.com'),
  authToken: z.string()
    .min(1)
    .describe('Auth Token||The Bearer token for authenticating with VCKit'),
  keyType: z.literal('Ed25519')
    .default('Ed25519')
    .describe('Key Algorithm||The key algorithm used when creating DIDs'),
});

/** Fields whose values should be treated as sensitive (e.g. masked in UI, encrypted at rest). */
export const vckitDidSensitiveFields: (keyof VCKitDidConfig)[] = ['authToken'];

export type VCKitDidConfig = z.infer<typeof vckitDidConfigSchema>;
