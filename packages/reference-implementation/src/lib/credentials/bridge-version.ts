// Subpath import and relative paths: this module is copied into the Docker
// image for the details backfill, where no tsconfig.json resolves aliases
// and the package barrel does not load under the CJS loader.
import { listRegisteredVersions } from '@uncefact/untp-ri-services/data-model-bridges';

/**
 * The registered data-model versions of `credentialType` whose version
 * appears as a complete path segment of one of the credential's `@context`
 * URLs, so `0.6.0` never matches a `0.6.1` context. Shared by the details
 * backfill (#953) and external registration (#955), which both have to pick
 * a bridge for a credential that arrived without a declared version.
 */
export function versionsMatchingContext(credentialType: string, context: unknown): string[] {
  const urls = contextUrls(context);
  return listRegisteredVersions(credentialType).filter((version) =>
    urls.some((url) => urlPathHasVersion(url, version)),
  );
}

function contextUrls(context: unknown): string[] {
  if (typeof context === 'string') {
    return [context];
  }
  if (Array.isArray(context)) {
    return context.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

/** A version matches when it appears as a complete path segment, so `0.6.0` does not match a `0.6.1` context URL. */
function urlPathHasVersion(url: string, version: string): boolean {
  try {
    return new URL(url).pathname.split('/').includes(version);
  } catch {
    return false;
  }
}
