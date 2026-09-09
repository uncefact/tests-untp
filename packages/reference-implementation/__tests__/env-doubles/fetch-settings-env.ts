/**
 * Isolates the credential-fetch private-address setting for one test file.
 *
 * Call it once at the top level of a suite. It records whatever the two names
 * hold when the suite's module is evaluated, clears both before every test, and
 * puts the recorded values back after every test, so a suite that sets one of
 * them cannot leak it into the next file the worker runs.
 *
 * It relies on Jest's hook ordering, which the suites using it depend on and
 * should not have to restate: hooks registered at a file's top level belong to
 * the implicit root block, so its `beforeEach` runs before any `beforeEach`
 * declared inside a `describe`, and its `afterEach` runs after them. A test
 * that sets one of these names inside a nested hook therefore still starts from
 * a cleared environment, whether this helper is called above or below the
 * `describe` blocks.
 */
const FETCH_ALLOW_PRIVATE_URL_NAMES = ['VERIFY_ALLOW_PRIVATE_URLS', 'FETCH_ALLOW_PRIVATE_URLS'] as const;

export function isolateFetchAllowPrivateUrlsEnv(): void {
  const original = FETCH_ALLOW_PRIVATE_URL_NAMES.map((name) => [name, process.env[name]] as const);

  beforeEach(() => {
    for (const name of FETCH_ALLOW_PRIVATE_URL_NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}
