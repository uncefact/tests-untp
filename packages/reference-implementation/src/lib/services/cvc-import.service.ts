import { importCatalogue } from '@/lib/prisma/repositories';
import { getCvcParser, SUPPORTED_CVC_VERSIONS } from '@uncefact/untp-ri-services';
import { ValidationError } from '@/lib/api/validation';

// ---------------------------------------------------------------------------
// importCvc
// ---------------------------------------------------------------------------

/**
 * Fetches CVC JSON-LD data from a URL, parses it using the version-specific
 * parser, and persists the catalogue via the repository.
 */
export async function importCvc(tenantId: string, url: string, version: string) {
  const parser = getCvcParser(version);
  if (!parser) {
    throw new ValidationError(`Unsupported CVC version: ${version}. Supported: ${SUPPORTED_CVC_VERSIONS.join(', ')}`);
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/ld+json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch CVC data from ${url}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const parsed = parser.parse(data, url);

  return importCatalogue({ ...parsed, tenantId, specVersion: version });
}

// ---------------------------------------------------------------------------
// importCvcFromData
// ---------------------------------------------------------------------------

/**
 * Parses pre-fetched CVC JSON-LD data and persists the catalogue via the
 * repository. Useful for seed scripts and tests that already have the data.
 */
export async function importCvcFromData(tenantId: string, data: unknown, sourceUrl: string, version: string) {
  const parser = getCvcParser(version);
  if (!parser) {
    throw new ValidationError(`Unsupported CVC version: ${version}. Supported: ${SUPPORTED_CVC_VERSIONS.join(', ')}`);
  }

  const parsed = parser.parse(data, sourceUrl);

  return importCatalogue({ ...parsed, tenantId, specVersion: version });
}
