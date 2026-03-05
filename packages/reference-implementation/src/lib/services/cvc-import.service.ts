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

  const signal = AbortSignal.timeout(15_000);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/ld+json' },
      signal,
    });
  } catch (err) {
    throw new ValidationError(
      `Unable to reach the CVC catalogue at ${url}. Check the URL is accessible and try again.`,
    );
  }

  if (!response.ok) {
    throw new ValidationError(
      `The remote server at ${url} responded with status ${response.status} ${response.statusText}.`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new ValidationError(
      `The URL ${url} did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: ReturnType<typeof parser.parse>;
  try {
    parsed = parser.parse(data, url);
  } catch (err) {
    throw new ValidationError(
      `Failed to parse CVC catalogue from ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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

  let parsed: ReturnType<typeof parser.parse>;
  try {
    parsed = parser.parse(data, sourceUrl);
  } catch (err) {
    throw new ValidationError(
      `Failed to parse CVC catalogue from ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return importCatalogue({ ...parsed, tenantId, specVersion: version });
}
