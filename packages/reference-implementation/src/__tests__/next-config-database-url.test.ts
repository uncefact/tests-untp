/**
 * @jest-environment node
 */
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';

import nextConfig from '../../next.config';

const PARTS = {
  RI_POSTGRES_USER: 'parts-user',
  RI_POSTGRES_PASSWORD: 'parts-pass',
  RI_POSTGRES_DB: 'parts-db',
  RI_POSTGRES_HOST: 'parts-host',
  RI_POSTGRES_PORT: '6543',
};

const ENV_KEYS = ['RI_DATABASE_URL', ...Object.keys(PARTS)] as const;

describe('next.config database URL precedence (#766)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('keeps a pre-set RI_DATABASE_URL over stale component variables', () => {
    process.env.RI_DATABASE_URL = 'postgresql://preset:pw@preset-host:5432/preset-db';
    Object.assign(process.env, PARTS);

    nextConfig(PHASE_DEVELOPMENT_SERVER);

    expect(process.env.RI_DATABASE_URL).toBe('postgresql://preset:pw@preset-host:5432/preset-db');
  });

  it('constructs RI_DATABASE_URL from component variables only when absent', () => {
    Object.assign(process.env, PARTS);

    nextConfig(PHASE_DEVELOPMENT_SERVER);

    expect(process.env.RI_DATABASE_URL).toBe(
      'postgresql://parts-user:parts-pass@parts-host:6543/parts-db?schema=public',
    );
  });

  it('fails loudly outside the production build phase when no database target exists', () => {
    expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).toThrow('No database target configured');
  });

  it('tolerates a missing database target during the production build phase', () => {
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).not.toThrow();
    expect(process.env.RI_DATABASE_URL).toBeUndefined();
  });
});
