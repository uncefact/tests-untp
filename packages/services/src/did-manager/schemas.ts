/**
 * DID Document validation schemas (Zod).
 *
 * @todo Define precise DID Document schema per W3C DID Core v1.0.
 * Current schema is a loose subset with .passthrough(). Tighten field
 * requirements, allowed values, and array constraints to match the spec.
 *
 * @see https://www.w3.org/TR/did-1.0/
 */

import { z } from 'zod';

export const verificationMethodSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    controller: z.string(),
    publicKeyJwk: z.record(z.unknown()).optional(),
    publicKeyMultibase: z.string().optional(),
  })
  .passthrough();

export const didDocumentSchema = z
  .object({
    '@context': z.union([z.string(), z.array(z.string())]),
    id: z.string(),
    verificationMethod: z.array(verificationMethodSchema).optional(),
    authentication: z.array(z.union([z.string(), verificationMethodSchema])).optional(),
    assertionMethod: z.array(z.union([z.string(), verificationMethodSchema])).optional(),
  })
  .passthrough();
