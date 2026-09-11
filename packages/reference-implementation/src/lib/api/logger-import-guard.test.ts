/** @jest-environment node */

jest.mock('./logger');
jest.mock('pg-boss', () => ({ PgBoss: class PgBoss {} }));
jest.mock('next-auth', () => ({
  __esModule: true,
  default: jest.fn(() => ({ handlers: {}, auth: jest.fn(), signIn: jest.fn(), signOut: jest.fn() })),
}));
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }));
jest.mock('next-auth/providers/keycloak', () => ({ __esModule: true, default: jest.fn(() => ({})) }));
jest.mock('next-auth/providers/zitadel', () => ({ __esModule: true, default: jest.fn(() => ({})) }));
jest.mock('next/server', () => ({ NextResponse: {} }));

import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = process.cwd();
const loggerChildModules = globSync('src/**/*.ts', { cwd: packageRoot })
  .filter((modulePath) => !modulePath.endsWith('.test.ts'))
  .filter((modulePath) => !modulePath.includes('/__mocks__/'))
  .filter((modulePath) => {
    const source = readFileSync(resolve(packageRoot, modulePath), 'utf8');
    return /(?:appLogger|apiLogger)\.child/.test(source);
  });

function importRuntimeModule(modulePath: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(resolve(packageRoot, modulePath));
}

describe('logger child import perimeter', () => {
  it('discovers runtime modules that construct child loggers', () => {
    expect(loggerChildModules).not.toHaveLength(0);
  });

  it.each(loggerChildModules)('imports %s without throwing', (modulePath) => {
    expect(() => importRuntimeModule(modulePath)).not.toThrow();
  });
});
