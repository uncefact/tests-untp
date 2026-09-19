import { databaseUrlFromEnvParts, setDatabaseUrlIfAbsent } from './database-url';

const asEnv = (vars: Record<string, string | undefined>): NodeJS.ProcessEnv => vars as unknown as NodeJS.ProcessEnv;

const PARTS = {
  RI_POSTGRES_USER: 'ri',
  RI_POSTGRES_PASSWORD: 'secret',
  RI_POSTGRES_DB: 'ri-db',
  RI_POSTGRES_HOST: 'localhost',
  RI_POSTGRES_PORT: '5433',
};

describe('databaseUrlFromEnvParts', () => {
  it('constructs the URL from the five RI_POSTGRES_* parts', () => {
    expect(databaseUrlFromEnvParts(asEnv(PARTS))).toBe('postgresql://ri:secret@localhost:5433/ri-db?schema=public');
  });

  it.each(Object.keys(PARTS))('returns undefined when %s is missing', (missing) => {
    const env = { ...PARTS, [missing]: undefined };
    expect(databaseUrlFromEnvParts(asEnv(env))).toBeUndefined();
  });
});

describe('setDatabaseUrlIfAbsent', () => {
  it('populates RI_DATABASE_URL from the RI_POSTGRES_* parts when it is absent', () => {
    const env = asEnv(PARTS);

    setDatabaseUrlIfAbsent(env, databaseUrlFromEnvParts(env));

    expect(env.RI_DATABASE_URL).toBe('postgresql://ri:secret@localhost:5433/ri-db?schema=public');
  });

  it('leaves an explicit RI_DATABASE_URL untouched', () => {
    const env = asEnv({ ...PARTS, RI_DATABASE_URL: 'postgresql://explicit.example/ri-db' });

    setDatabaseUrlIfAbsent(env, databaseUrlFromEnvParts(env));

    expect(env.RI_DATABASE_URL).toBe('postgresql://explicit.example/ri-db');
  });
});
