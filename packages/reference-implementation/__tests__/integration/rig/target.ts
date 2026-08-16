/**
 * Database-target resolution for the integration rig.
 *
 * The rig operates under one safety contract (ADR-029 integration layer;
 * #900): the only database a suite may touch is the one this module
 * resolves, either a guarded external `TEST_DATABASE_URL` or the ephemeral
 * container the rig itself started. The resolved URL is forced onto
 * `RI_DATABASE_URL` before any Prisma command or client construction, so the
 * repository `.env`'s developer database can never be inherited. The suites
 * truncate tables between tests, which is why an external URL is refused
 * when its database name matches a real environment.
 */

/**
 * Database names used by the real environments in this repository's compose
 * files: `ri` (`ri-db` and `e2e-ri-db`) and `vckit` (the VCKit `db`
 * service). An external target with one of these names is refused unless
 * the operator explicitly accepts destruction.
 */
const GUARDED_DATABASE_NAMES = new Set(['ri', 'vckit']);

export interface ResolvedTarget {
  url: string;
  source: 'external' | 'ephemeral';
}

/** Redacted description safe for error messages (never the raw URL, which carries credentials). */
function describeTarget(parsed: URL | null, raw: string): string {
  if (!parsed) return `a malformed URL (${raw.length} characters, not echoed in case it carries credentials)`;
  return `host "${parsed.hostname}:${parsed.port || '5432'}", path "${parsed.pathname}"`;
}

/**
 * Validates an operator-supplied external database URL. Throws when the URL
 * is malformed, names no single unambiguous database, selects a non-public
 * Prisma schema (cleanup truncates `public` only), or names a database that
 * looks like a real environment, unless `acceptDestructive` (from
 * `TEST_DATABASE_ACCEPT_DESTRUCTIVE=true`) is set. The database name is
 * percent-decoded and trailing-slash-normalised before comparison, so
 * encodings of a guarded name cannot slip past.
 */
export function guardExternalUrl(raw: string, acceptDestructive: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid URL: ${describeTarget(null, raw)}`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`TEST_DATABASE_URL must be a postgresql:// URL, got "${parsed.protocol}//"`);
  }

  const segments = parsed.pathname
    .split('/')
    .slice(1)
    .filter((s) => s.length > 0);
  if (segments.length !== 1) {
    throw new Error(`TEST_DATABASE_URL must name exactly one database in its path; got ${describeTarget(parsed, raw)}`);
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(segments[0]);
  } catch {
    throw new Error(`TEST_DATABASE_URL has an undecodable database name; got ${describeTarget(parsed, raw)}`);
  }

  const schemaParams = parsed.searchParams.getAll('schema');
  if (schemaParams.length > 1 || (schemaParams.length === 1 && schemaParams[0] !== 'public')) {
    throw new Error(
      `TEST_DATABASE_URL selects a non-public (or ambiguous) Prisma schema, but the rig's between-test cleanup truncates the "public" schema only. Use a dedicated database on the public schema.`,
    );
  }

  if (!acceptDestructive && GUARDED_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${databaseName}", which matches a real environment's database name. ` +
        `The integration suites TRUNCATE tables between tests. Point TEST_DATABASE_URL at a dedicated test database, ` +
        `or set TEST_DATABASE_ACCEPT_DESTRUCTIVE=true if this database really is disposable.`,
    );
  }
  return raw;
}
