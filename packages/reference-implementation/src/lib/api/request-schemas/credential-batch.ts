import { z } from 'zod';
import { credentialBatchItemRequestSchema } from './credential';

/**
 * The batch boundary owns only request shape. Each item is the exact same
 * shape accepted by the single issuance route; ownership, service and
 * credential conformance checks remain per-item worker work.
 */
export const credentialBatchRequestSchema = z.object({
  items: z.array(credentialBatchItemRequestSchema).min(1, 'must contain at least one item'),
});

export type CredentialBatchRequest = z.infer<typeof credentialBatchRequestSchema>;
