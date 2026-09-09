/**
 * The three settings that govern caller-supplied credential retrieval: whether
 * private and reserved addresses are allowed, the maximum response size, and
 * the whole-fetch time budget. They apply to verification, external
 * registration and the supplier-source check used by re-verification. The
 * private-address setting also relaxes the existing stored-address URL checks
 * on the registrar, identifier-link, data-model, service and credential
 * publishing routes. None of them applies to context or schema fetches, or to
 * the worker's stored-copy read.
 *
 * Each setting has a new `FETCH_` name and its RI v0.4 `VERIFY_` name. The old
 * name is read throughout RI v0.5 and produces a startup warning, and it stops
 * being read in RI v0.6 (#992). Setting both names of one pair, non-blank
 * after trimming, fails startup whatever the values are, because a boolean and
 * a byte count carry nothing that would let equal values count as agreement.
 *
 * The readers are uncached, so a pair introduced after boot is seen by the
 * next call. That call throws inside a route gate or the fetch helper, and the
 * unchanged route wrappers answer 500 with the conflict text, on authenticated
 * routes and on the public verify route alike. That text carries the two
 * variable names and no values, which is the accepted limit of this design.
 *
 * The module deliberately imports nothing from the services package, from
 * `@/` or from any dependency, so the e2e workspace can load it by relative
 * path with no build step.
 */

const DEFAULT_MAX_RESPONSE_SIZE = 10_485_760;
const DEFAULT_TIMEOUT_MS = 10_000;
/** A public route holds a request open for the whole budget, so it has a ceiling. */
const MAX_TIMEOUT_MS = 120_000;

type FetchSettingPair = {
  oldName: string;
  newName: string;
};

/**
 * Which name supplied the value, and that name. `raw` is the original string,
 * untrimmed, so each setting's own parser sees exactly what the operator set.
 * A setting with no value carries no name and no `raw`, so "deprecated name
 * but no value" is unrepresentable.
 */
type ResolvedFetchSetting =
  | { source: 'absent' }
  | { source: 'new'; name: string; raw: string }
  | { source: 'old'; name: string; raw: string };

/**
 * Keyed by setting rather than ordered, so each reader names the pair it
 * reads. Deleting a pair in v0.6 is then a compile error in that reader
 * instead of a silent re-point at whichever pair moved into the free slot.
 */
const FETCH_SETTING_PAIRS = {
  allowPrivateUrls: { oldName: 'VERIFY_ALLOW_PRIVATE_URLS', newName: 'FETCH_ALLOW_PRIVATE_URLS' },
  maxResponseSize: { oldName: 'VERIFY_MAX_CREDENTIAL_SIZE', newName: 'FETCH_MAX_RESPONSE_SIZE' },
  timeoutMs: { oldName: 'VERIFY_FETCH_TIMEOUT_MS', newName: 'FETCH_TIMEOUT_MS' },
} as const satisfies Record<string, FetchSettingPair>;

function resolveFetchSetting(env: Record<string, string | undefined>, pair: FetchSettingPair): ResolvedFetchSetting {
  const oldValue = env[pair.oldName];
  const newValue = env[pair.newName];
  const oldIsSet = oldValue !== undefined && oldValue.trim() !== '';
  const newIsSet = newValue !== undefined && newValue.trim() !== '';

  if (oldIsSet && newIsSet) {
    throw new Error(
      `${pair.oldName} and ${pair.newName} are both set. ${pair.oldName} was renamed to ${pair.newName} in v0.5. Set ${pair.newName} to the value you intend, remove ${pair.oldName}, and restart.`,
    );
  }

  if (newIsSet) return { source: 'new', name: pair.newName, raw: newValue };
  if (oldIsSet) return { source: 'old', name: pair.oldName, raw: oldValue };
  return { source: 'absent' };
}

/**
 * Exact string comparison is intentional: only lowercase `true` enables the
 * development relaxation, so a typo, `TRUE` or a padded value leaves the SSRF
 * protection on rather than quietly turning it off.
 */
export function readFetchAllowPrivateUrls(env: Record<string, string | undefined> = process.env): boolean {
  const resolved = resolveFetchSetting(env, FETCH_SETTING_PAIRS.allowPrivateUrls);
  return resolved.source !== 'absent' && resolved.raw === 'true';
}

/**
 * The response-size cap in bytes. The ceiling exists so one caller-supplied
 * URL cannot make the process hold an unbounded body. The parse is
 * deliberately lenient, unchanged by the rename: anything `parseInt` cannot
 * read as a positive number falls back to the default instead of failing the
 * boot, because a mistyped size still leaves a safe bound in force.
 */
export function readFetchMaxResponseSize(env: Record<string, string | undefined> = process.env): number {
  const resolved = resolveFetchSetting(env, FETCH_SETTING_PAIRS.maxResponseSize);
  if (resolved.source === 'absent') return DEFAULT_MAX_RESPONSE_SIZE;
  const parsed = parseInt(resolved.raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESPONSE_SIZE;
}

/**
 * The whole-fetch time budget in milliseconds, covering connect, redirects and
 * body. Unlike the size, an unusable value throws: a public route holds a
 * request open for the whole budget, so silently running on the default when
 * the operator asked for something else is a difference they need to be told
 * about. The throw is surfaced at process boot (instrumentation.node.ts), and
 * the message names whichever of the two names was actually supplied.
 */
export function readFetchTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const resolved = resolveFetchSetting(env, FETCH_SETTING_PAIRS.timeoutMs);
  if (resolved.source === 'absent') return DEFAULT_TIMEOUT_MS;
  const parsed = Number(resolved.raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(
      `${resolved.name} must be a positive integer number of milliseconds no greater than ${MAX_TIMEOUT_MS} when set; fix or unset it (unset uses ${DEFAULT_TIMEOUT_MS}).`,
    );
  }
  return parsed;
}

/**
 * The boot check. For all three settings it checks presence and rejects a pair
 * whose two names are both set. It additionally validates the timeout's value.
 * It does not validate the size's value: a size the parser cannot read falls
 * back to the 10 MB default at read time, by design. Every setting is checked
 * before any warning is emitted, so a boot that is about to fail logs no
 * rename advice it would then contradict. One warning per setting still
 * supplied under its old name.
 */
export function validateFetchSettingsOnBoot(
  logger: { warn(message: string): void },
  env: Record<string, string | undefined> = process.env,
): void {
  readFetchAllowPrivateUrls(env);
  readFetchMaxResponseSize(env);
  readFetchTimeoutMs(env);

  for (const pair of Object.values(FETCH_SETTING_PAIRS)) {
    const resolved = resolveFetchSetting(env, pair);
    if (resolved.source === 'old') {
      logger.warn(
        `${pair.oldName} was renamed to ${pair.newName} in v0.5 and will stop being read in v0.6. Rename ${pair.oldName} to ${pair.newName}, keeping its value, and restart.`,
      );
    }
  }
}

/**
 * The application's answer for the private-address setting when the operator
 * has supplied it, and `undefined` when neither name is set (blank counts as
 * unset). It exists so a caller outside the application, such as the Cypress
 * harness, can tell "the operator asked for this" apart from "nobody said",
 * and apply its own default only in the second case, while still reading the
 * value through the application's own presence, conflict and parsing rules.
 *
 * A both-names conflict throws here, exactly as it would at the application's
 * boot. When `cypress.config.ts` evaluates, that throw fails every spec's load
 * deliberately: the application would refuse the same environment, so a run
 * against it could only report a state the deployment cannot reach.
 */
export function readFetchAllowPrivateUrlsIfSet(env: Record<string, string | undefined>): boolean | undefined {
  const resolved = resolveFetchSetting(env, FETCH_SETTING_PAIRS.allowPrivateUrls);
  if (resolved.source === 'absent') return undefined;
  return readFetchAllowPrivateUrls(env);
}
