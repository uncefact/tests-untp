import { guardExternalUrl } from './rig/target';

/**
 * Pure-function tests for the external-URL guard. They live in the
 * integration tree because the guard is rig code the unit run must not
 * collect, so they run under the integration job (docker and all) even
 * though the assertions themselves never touch a database. The guard is
 * the only thing between an operator's stale shell variable and a
 * truncated real database, so every bypass shape found in review is
 * pinned here.
 */
describe('guardExternalUrl', () => {
  const ok = 'postgresql://test:test@localhost:5544/ri_test';

  it('accepts a dedicated test database', () => {
    expect(guardExternalUrl(ok, false)).toBe(ok);
  });

  it.each([
    ['plain', 'postgresql://u:p@localhost:5433/ri'],
    ['percent-encoded', 'postgresql://u:p@localhost:5433/%72i'],
    ['trailing slash', 'postgresql://u:p@localhost:5433/ri/'],
    ['vckit compose database', 'postgresql://u:p@localhost:5432/vckit'],
  ])('refuses a guarded database name (%s)', (_label, url) => {
    expect(() => guardExternalUrl(url, false)).toThrow(/matches a real environment|exactly one database/);
  });

  it('a trailing slash normalises rather than changing the compared name', () => {
    // The bypass shape was "/ri/" reading as "ri/" and missing the guard;
    // normalisation must strip the empty segment on safe names too.
    expect(guardExternalUrl('postgresql://u:p@localhost:5433/ri_test/', false)).toBeTruthy();
  });

  it('allows a guarded name only with the explicit destructive acknowledgement', () => {
    expect(guardExternalUrl('postgresql://u:p@localhost:5433/ri', true)).toBeTruthy();
  });

  it('refuses a non-postgres scheme, an empty path, and a multi-segment path', () => {
    expect(() => guardExternalUrl('mysql://u:p@localhost/db', false)).toThrow(/postgresql/);
    expect(() => guardExternalUrl('postgresql://u:p@localhost:5433/', false)).toThrow(/exactly one database/);
    expect(() => guardExternalUrl('postgresql://u:p@localhost:5433/a/b', false)).toThrow(/exactly one database/);
  });

  it('refuses a non-public Prisma schema (cleanup truncates public only)', () => {
    expect(() => guardExternalUrl('postgresql://u:p@localhost:5433/ri_test?schema=other', false)).toThrow(/public/);
  });

  it('never echoes credentials in its errors', () => {
    const secret = 'postgresql://user:sup3rs3cret@localhost:5433';
    let message = '';
    try {
      guardExternalUrl(`${secret}/`, false);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain('sup3rs3cret');
    expect(message).toContain('localhost');
  });
});
