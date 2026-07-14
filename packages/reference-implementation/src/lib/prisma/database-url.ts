/**
 * Builds RI_DATABASE_URL from the individual RI_POSTGRES_* variables, or
 * returns undefined when any part is missing. Callers must prefer an
 * explicitly set RI_DATABASE_URL over this construction (the same
 * construct-only-if-absent rule as docker-entrypoint.sh): standalone scripts
 * that overwrite an explicit URL can silently retarget a destructive
 * operation at the wrong database.
 */
export function databaseUrlFromEnvParts(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const { RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST, RI_POSTGRES_PORT } = env;
  if (!RI_POSTGRES_USER || !RI_POSTGRES_PASSWORD || !RI_POSTGRES_DB || !RI_POSTGRES_HOST || !RI_POSTGRES_PORT) {
    return undefined;
  }
  return `postgresql://${RI_POSTGRES_USER}:${RI_POSTGRES_PASSWORD}@${RI_POSTGRES_HOST}:${RI_POSTGRES_PORT}/${RI_POSTGRES_DB}?schema=public`;
}
