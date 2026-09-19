import { z } from 'zod';
import { credentialBatchItemRequestSchema } from './credential';

/**
 * The batch boundary owns only request shape. Each item uses the exact shape
 * accepted by the single issuance route plus its optional issuer reference;
 * ownership, service and credential conformance checks remain per-item worker
 * work.
 */
export const credentialBatchRequestSchema = z.object({
  items: z.array(credentialBatchItemRequestSchema).min(1, 'must contain at least one item'),
});

export type CredentialBatchItemRequest = z.infer<typeof credentialBatchItemRequestSchema>;
export type CredentialBatchRequest = z.infer<typeof credentialBatchRequestSchema>;
