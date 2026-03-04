import type { ICvcParser, ParsedCvcCatalogue } from '../types.js';

// ---------------------------------------------------------------------------
// Slug derivation helpers
// ---------------------------------------------------------------------------

/**
 * Derives a slug from the last segment of a URL path.
 *
 * E.g. `"https://example.com/cvc/sample-scheme"` -> `"sample-scheme"`
 */
function slugFromUrl(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

/**
 * Derives a profile slug from a URL path. If the last segment looks like a
 * semver-style version string (e.g. `"8.0.2"`), the second-to-last segment
 * is used instead.
 *
 * E.g. `"https://example.com/cvc/scheme/profile-full/1.0.0"` -> `"profile-full"`
 */
function profileSlugFromUrl(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && /^\d+\.\d+/.test(segments[segments.length - 1])) {
    return segments[segments.length - 2];
  }
  return segments[segments.length - 1] ?? '';
}

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

type JsonLdRoot = {
  id?: string;
  name?: string;
  conformityScheme?: JsonLdScheme[];
  [key: string]: unknown;
};

type JsonLdScheme = {
  id?: string;
  name?: string;
  description?: string;
  includedProfile?: JsonLdProfile[];
  [key: string]: unknown;
};

type JsonLdProfile = {
  id?: string;
  name?: string;
  version?: string;
  status?: string;
  description?: string;
  criterion?: JsonLdCriterion[];
  [key: string]: unknown;
};

type JsonLdCriterion = {
  id?: string;
  name?: string;
  version?: string;
  status?: string;
  description?: string;
  conformityTopic?: string;
  passThreshold?: Record<string, unknown>;
  documentation?: string;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// CvcV070Parser
// ---------------------------------------------------------------------------

/**
 * Parser for CVC spec version 0.7.0.
 *
 * JSON-LD shape:
 *   ConformityVocabularyCatalog
 *     -> conformityScheme[]
 *       -> includedProfile[]
 *         -> criterion[]
 */
export class CvcV070Parser implements ICvcParser {
  parse(data: unknown, sourceUrl: string): ParsedCvcCatalogue {
    const root = data as JsonLdRoot;

    if (!root || typeof root !== 'object') {
      throw new Error('CVC JSON-LD data must be a non-null object');
    }

    if (!root.id) {
      throw new Error('CVC JSON-LD missing root id');
    }

    const conformitySchemes = root.conformityScheme;
    if (!Array.isArray(conformitySchemes)) {
      throw new Error('CVC JSON-LD missing conformityScheme array');
    }

    // Derive catalogue name from root `name` or from the URL hostname
    const name = root.name || new URL(sourceUrl).hostname;

    const schemes = conformitySchemes.map((scheme) => {
      if (!scheme.id) {
        throw new Error('CVC JSON-LD scheme missing id');
      }
      if (!scheme.name) {
        throw new Error('CVC JSON-LD scheme missing name');
      }

      const profiles = (scheme.includedProfile ?? []).map((profile) => {
        if (!profile.id) {
          throw new Error('CVC JSON-LD profile missing id');
        }
        if (!profile.name) {
          throw new Error('CVC JSON-LD profile missing name');
        }
        if (!profile.version) {
          throw new Error('CVC JSON-LD profile missing version');
        }
        if (!profile.status) {
          throw new Error('CVC JSON-LD profile missing status');
        }

        const criteria = (profile.criterion ?? []).map((criterion) => {
          if (!criterion.id) {
            throw new Error('CVC JSON-LD criterion missing id');
          }
          if (!criterion.name) {
            throw new Error('CVC JSON-LD criterion missing name');
          }
          if (!criterion.version) {
            throw new Error('CVC JSON-LD criterion missing version');
          }
          if (!criterion.status) {
            throw new Error('CVC JSON-LD criterion missing status');
          }

          return {
            canonicalId: criterion.id,
            name: criterion.name,
            version: criterion.version,
            status: criterion.status,
            description: criterion.description,
            conformityTopic: criterion.conformityTopic,
            passThreshold: criterion.passThreshold,
            documentation: criterion.documentation,
          };
        });

        return {
          canonicalId: profile.id,
          name: profile.name,
          slug: profileSlugFromUrl(profile.id),
          version: profile.version,
          status: profile.status,
          description: profile.description,
          criteria,
        };
      });

      return {
        canonicalId: scheme.id,
        name: scheme.name,
        slug: slugFromUrl(scheme.id),
        description: scheme.description,
        profiles,
      };
    });

    return {
      canonicalId: root.id,
      name,
      sourceUrl,
      schemes,
    };
  }
}
