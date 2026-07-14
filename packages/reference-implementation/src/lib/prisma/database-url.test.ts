import { databaseUrlFromEnvParts } from './database-url';

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
