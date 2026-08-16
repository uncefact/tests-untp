import { z } from 'zod';

// ── Issuer-facing browse projections ───────────────────────────────────────────
// Flat, picker-friendly shapes that let an issuer drill scheme -> profile ->
// criterion and yield the canonical URIs a conformityClaim carries (profile and
// criterion URIs are versioned; the scheme URI is not). Defined as Zod schemas
// so the OpenAPI components (registered in lib/swagger/schemas.ts) and the
// repository's declared return types come from one definition rather than two
// hand-maintained copies. The projections are not parsed through these schemas
// at runtime, so a mapper that builds a different shape is caught by the
// compiler at the return sites rather than by validation.
// This module stays free of Prisma imports so the Swagger generator can load
// it without pulling in the database client.

/** Reference to a scheme owner; mirrors ConformitySchemeOwner from untp-utils. */
const conformitySchemeOwnerSummarySchema = z.object({
  canonicalId: z.string().optional(),
  name: z.string().optional(),
});

/** A topic a criterion addresses; mirrors ConformityTopic from untp-utils. */
const conformityTopicSummarySchema = z.object({
  canonicalId: z.string(),
  name: z.string().optional(),
  definition: z.string().optional(),
});

/** A conformity scheme as listed in the browse API; `id` is the canonical URI. */
export const conformitySchemeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  specVersion: z.string(),
  owner: conformitySchemeOwnerSummarySchema.optional(),
});
export type ConformitySchemeSummary = z.infer<typeof conformitySchemeSummarySchema>;

/** A profile as listed under a scheme; `id` is the canonical (versioned) URI. */
export const conformityProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.string(),
  validFrom: z.string().optional(),
});
export type ConformityProfileSummary = z.infer<typeof conformityProfileSummarySchema>;

/** A criterion as listed under a profile; `id` is the canonical (versioned) URI. */
export const conformityCriterionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.string(),
  topics: z.array(conformityTopicSummarySchema),
  tags: z.array(z.string()),
});
export type ConformityCriterionSummary = z.infer<typeof conformityCriterionSummarySchema>;
