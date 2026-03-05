/**
 * Parsed CVC catalogue output — the normalised shape that any version-specific
 * parser must produce. The reference implementation's repository layer consumes
 * this directly (adding `tenantId` and `specVersion` at the call site).
 */
export type ParsedCvcCatalogue = {
  canonicalId: string;
  name: string;
  sourceUrl: string;
  schemes: ParsedCvcScheme[];
};

export type ParsedCvcScheme = {
  canonicalId: string;
  name: string;
  slug: string;
  description?: string;
  metadata?: Record<string, unknown>;
  profiles: ParsedCvcProfile[];
};

export type ParsedCvcProfile = {
  canonicalId: string;
  name: string;
  slug: string;
  version: string;
  status: string;
  description?: string;
  metadata?: Record<string, unknown>;
  criteria: ParsedCvcCriterion[];
};

export type ParsedCvcCriterion = {
  canonicalId: string;
  name: string;
  version: string;
  status: string;
  description?: string;
  conformityTopic?: string;
  passThreshold?: Record<string, unknown>;
  documentation?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Version-specific CVC parser. Each supported CVC spec version has its own
 * implementation that knows how to extract the hierarchy from that version's
 * JSON-LD shape.
 */
export interface ICvcParser {
  parse(data: unknown, sourceUrl: string): ParsedCvcCatalogue;
}
