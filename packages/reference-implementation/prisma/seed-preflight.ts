import type { z } from 'zod';
import { adapterRegistry, ServiceType } from '@uncefact/untp-ri-services';
import { resolveDataEncryptionKey } from '../src/lib/encryption/resolve-data-encryption-key.js';

/**
 * Pure, env-only resolution of what the seed can and cannot configure,
 * decided before the seed writes anything or calls any external service
 * (ADR-043, decision 3). This module answers one question per category:
 * is its required configuration present? It does not attempt a category's
 * actual work (no database writes, no HTTP calls, no adapter construction
 * beyond a schema parse), so `seed.ts` still owns resolving and executing
 * each category; this only decides whether the run should proceed.
 */

export type CategoryName = 'encryption' | 'idr' | 'storage' | 'vc' | 'did' | 'renderTemplates';

/** Every category other than `encryption`, which is a gate rather than something the seed seeds directly. */
export type ExecutionCategoryName = Exclude<CategoryName, 'encryption'>;

/**
 * The categories the seed actually executes. `encryption` is a gate that
 * other categories depend on rather than something the seed seeds on its
 * own, so it is tracked in `categories` but excluded here.
 */
export const EXECUTION_CATEGORIES: ExecutionCategoryName[] = ['idr', 'storage', 'vc', 'did', 'renderTemplates'];

export type CategoryStatus = 'ok' | 'missing' | 'other';

export interface CategoryResult {
  status: CategoryStatus;
  /** Environment variable names responsible, set only when status is 'missing'. */
  missingVars?: string[];
  /** Present when status is 'other' (unknown adapter type, invalid value): not a missing variable. */
  reason?: string;
  /** The category whose own unmet requirement this result was propagated from, when gated. */
  gatedBy?: CategoryName;
}

export interface SeedPreflightResult {
  categories: Record<CategoryName, CategoryResult>;
  /** Missing environment variables, keyed by every category that reports them (including gated ones). */
  missingByCategory: Record<string, string[]>;
  /**
   * For a category that is 'missing' AND also has an unrelated problem (an
   * invalid value in another field, or an adapter-type typo): that other
   * problem's description, keyed by category. Reported alongside the
   * missing variables rather than dropped, so an operator sees both
   * problems in the same boot cycle instead of redeploying once per fix.
   */
  otherIssuesByCategory: Record<string, string>;
  hasMissing: boolean;
}

/**
 * `SYSTEM_DID=` or `SYSTEM_IDR_API_KEY=  ` in an env file is the common
 * shape of "not configured", not a deliberate empty value; no field this
 * preflight resolves has a legitimate empty-string or whitespace-only
 * value. Normalising an empty or whitespace-only value to `undefined`
 * before it reaches zod means it fails the same `invalid_type` /
 * `received: undefined` way an absent variable does, so it is classified
 * 'missing' through the same path rather than needing a second check.
 * Exported so `seed.ts`'s own execution consumes the same normalisation:
 * without it, a whitespace-only value preflight correctly calls missing
 * would still satisfy zod's `.min(1)` and get written to the database.
 */
export function normalizeEnvValue(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/**
 * Only an issue that means "this field was never supplied" counts as a
 * missing environment variable. Every other zod failure (a value present
 * but the wrong shape) is a configuration mistake, not an absence, and
 * ADR-043 decision 2 keeps those in today's warn-and-skip behaviour rather
 * than the fail-loud posture.
 */
function isMissingIssue(issue: z.ZodIssue): boolean {
  return issue.code === 'invalid_type' && (issue as { received?: unknown }).received === 'undefined';
}

/**
 * Every field this preflight resolves that has its own environment
 * variable, independent of whether the adapter type naming it is even
 * recognised. Checking these directly against `env` (rather than only
 * through a recognised adapter's zod schema) is what lets a missing
 * variable win over an unrelated problem in the same category (see
 * `classifyCategory` below): the schema can't be parsed against an unknown
 * adapter type at all, but whether its known fields were ever supplied is
 * still answerable from the raw environment.
 */
function computeMissingVars(env: NodeJS.ProcessEnv, fieldToEnvVar: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const envVar of Object.values(fieldToEnvVar)) {
    if (normalizeEnvValue(env[envVar]) === undefined) missing.add(envVar);
  }
  return Array.from(missing);
}

/**
 * Splits a schema parse's failures into missing variables (a field whose
 * env var was never supplied) and everything else (an invalid value, a
 * malformed URL, an out-of-range enum). Kept separate rather than folded
 * into one verdict, because whether a category counts as 'missing' must
 * depend only on the first set, never on whether the second is also
 * non-empty (see `classifyCategory`).
 */
function classifyParse(
  result: z.SafeParseReturnType<unknown, unknown>,
  fieldToEnvVar: Record<string, string>,
): { missingVars: string[]; otherReasons: string[] } {
  if (result.success) return { missingVars: [], otherReasons: [] };

  const missingVars = new Set<string>();
  const otherReasons: string[] = [];
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]);
    const envVar = fieldToEnvVar[field];
    if (isMissingIssue(issue) && envVar) {
      missingVars.add(envVar);
    } else {
      otherReasons.push(issue.message);
    }
  }
  return { missingVars: Array.from(missingVars), otherReasons };
}

/**
 * The single rule every adapter category is classified by: a missing
 * required variable always makes the category 'missing', regardless of
 * whether the category also has an unrelated problem (an invalid value in
 * another field, or an adapter-type typo). Reversing that priority would
 * mean a second, independent mistake in the same category (mistyping
 * SYSTEM_VC_BASE_URL, say) downgrades an absent SYSTEM_VC_API_KEY out of
 * the fail-loud posture, so making a deployment's configuration worse
 * would make validation weaker.
 *
 * When a category is 'missing' AND also has an unrelated problem,
 * `reason` is carried alongside `missingVars` rather than dropped: an
 * operator who fixes only the missing variable, redeploys, and only then
 * discovers the typo has paid for two boot cycles a single message could
 * have covered, the same principle decision 4 already applies to reporting
 * every missing variable together.
 */
function classifyCategory(missingVars: string[], otherReason: string | undefined): CategoryResult {
  if (missingVars.length > 0) return { status: 'missing', missingVars, reason: otherReason };
  if (otherReason) return { status: 'other', reason: otherReason };
  return { status: 'ok' };
}

function resolveEncryptionCategory(env: NodeJS.ProcessEnv): CategoryResult {
  try {
    const resolved = resolveDataEncryptionKey(env);
    // resolveDataEncryptionKey() is a shared utility (also used at app
    // startup) that already treats an empty string as absent via `||`; a
    // whitespace-only value is not, so it is normalised here rather than
    // by changing that function's own semantics.
    if (!normalizeEnvValue(resolved.key)) {
      return { status: 'missing', missingVars: ['DATA_ENCRYPTION_KEY (or the deprecated SERVICE_ENCRYPTION_KEY)'] };
    }
    return { status: 'ok' };
  } catch (error) {
    // Divergent DATA_ENCRYPTION_KEY / SERVICE_ENCRYPTION_KEY values: not a
    // missing variable, so it does not trigger the fail-loud posture here.
    // The reason is still carried, and the same divergence throws again
    // when the seed resolves the key for real, where the outer handler
    // reports it with the run's summary.
    return { status: 'other', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Maps each of the adapter's own zod-required fields to the environment
 * variable an operator sets it from. A field added to the adapter's schema
 * without a matching entry here is caught by
 * `seed-preflight-field-coverage.test.ts`, which derives the required
 * field set from the schema itself rather than trusting this map to have
 * kept up.
 */
export const IDR_FIELD_TO_ENV: Record<string, string> = {
  baseUrl: 'SYSTEM_IDR_BASE_URL',
  apiKey: 'SYSTEM_IDR_API_KEY',
  defaultLinkType: 'SYSTEM_IDR_DEFAULT_LINK_TYPE',
  defaultMimeType: 'SYSTEM_IDR_DEFAULT_MIME_TYPE',
  defaultIanaLanguage: 'SYSTEM_IDR_DEFAULT_LANGUAGE',
  defaultContext: 'SYSTEM_IDR_DEFAULT_CONTEXT',
};

function resolveIdrCategory(env: NodeJS.ProcessEnv): CategoryResult {
  const idrAdapters = adapterRegistry[ServiceType.IDR];
  const adapterType = (env.SYSTEM_IDR_ADAPTER_TYPE as keyof typeof idrAdapters) || 'PYX_IDR';
  const entry = idrAdapters[adapterType];
  if (!entry) {
    return classifyCategory(computeMissingVars(env, IDR_FIELD_TO_ENV), `Unknown IDR adapter type: "${adapterType}"`);
  }
  const result = entry.configSchema.safeParse({
    baseUrl: normalizeEnvValue(env.SYSTEM_IDR_BASE_URL),
    apiKey: normalizeEnvValue(env.SYSTEM_IDR_API_KEY),
    apiVersion: normalizeEnvValue(env.SYSTEM_IDR_API_VERSION),
    defaultLinkType: normalizeEnvValue(env.SYSTEM_IDR_DEFAULT_LINK_TYPE),
    defaultMimeType: normalizeEnvValue(env.SYSTEM_IDR_DEFAULT_MIME_TYPE),
    defaultIanaLanguage: normalizeEnvValue(env.SYSTEM_IDR_DEFAULT_LANGUAGE),
    defaultContext: normalizeEnvValue(env.SYSTEM_IDR_DEFAULT_CONTEXT),
    defaultFwqs: env.SYSTEM_IDR_DEFAULT_FWQS === 'true',
  });
  const { missingVars, otherReasons } = classifyParse(result, IDR_FIELD_TO_ENV);
  return classifyCategory(missingVars, otherReasons.length > 0 ? otherReasons.join('; ') : undefined);
}

export const STORAGE_FIELD_TO_ENV: Record<string, string> = {
  baseUrl: 'SYSTEM_STORAGE_BASE_URL',
  publicBucket: 'SYSTEM_STORAGE_PUBLIC_BUCKET',
  privateBucket: 'SYSTEM_STORAGE_PRIVATE_BUCKET',
};

function resolveStorageCategory(env: NodeJS.ProcessEnv): CategoryResult {
  const storageAdapters = adapterRegistry[ServiceType.STORAGE];
  const adapterType = (env.SYSTEM_STORAGE_ADAPTER_TYPE as keyof typeof storageAdapters) || 'UNCEFACT_STORAGE';
  const entry = storageAdapters[adapterType];
  if (!entry) {
    return classifyCategory(
      computeMissingVars(env, STORAGE_FIELD_TO_ENV),
      `Unknown storage adapter type: "${adapterType}"`,
    );
  }
  const result = entry.configSchema.safeParse({
    baseUrl: normalizeEnvValue(env.SYSTEM_STORAGE_BASE_URL),
    apiKey: normalizeEnvValue(env.SYSTEM_STORAGE_API_KEY),
    apiVersion: normalizeEnvValue(env.SYSTEM_STORAGE_API_VERSION),
    publicBucket: normalizeEnvValue(env.SYSTEM_STORAGE_PUBLIC_BUCKET),
    privateBucket: normalizeEnvValue(env.SYSTEM_STORAGE_PRIVATE_BUCKET),
  });
  const { missingVars, otherReasons } = classifyParse(result, STORAGE_FIELD_TO_ENV);
  return classifyCategory(missingVars, otherReasons.length > 0 ? otherReasons.join('; ') : undefined);
}

export const VC_FIELD_TO_ENV: Record<string, string> = {
  baseUrl: 'SYSTEM_VC_BASE_URL',
  apiKey: 'SYSTEM_VC_API_KEY',
};

function resolveVcCategory(env: NodeJS.ProcessEnv): CategoryResult {
  const vcAdapters = adapterRegistry[ServiceType.VC];
  const adapterType = (env.SYSTEM_VC_ADAPTER_TYPE as keyof typeof vcAdapters) || 'VCKIT';
  const entry = vcAdapters[adapterType];
  if (!entry) {
    return classifyCategory(computeMissingVars(env, VC_FIELD_TO_ENV), `Unknown VC adapter type: "${adapterType}"`);
  }
  const result = entry.configSchema.safeParse({
    baseUrl: normalizeEnvValue(env.SYSTEM_VC_BASE_URL),
    apiKey: normalizeEnvValue(env.SYSTEM_VC_API_KEY),
    apiVersion: normalizeEnvValue(env.SYSTEM_VC_API_VERSION),
  });
  const { missingVars, otherReasons } = classifyParse(result, VC_FIELD_TO_ENV);
  return classifyCategory(missingVars, otherReasons.length > 0 ? otherReasons.join('; ') : undefined);
}

/**
 * Mirrors `getDidConfig`'s own requirement (SYSTEM_DID must be set) without
 * going through its module-level cache, so preflight stays a pure function
 * of the env it is given rather than of whichever env last populated that
 * cache. `seed.ts` still calls `getDidConfig` itself when it actually seeds
 * the DID.
 */
function resolveDidCategory(env: NodeJS.ProcessEnv): CategoryResult {
  if (!normalizeEnvValue(env.SYSTEM_DID)) {
    return { status: 'missing', missingVars: ['SYSTEM_DID'] };
  }
  return { status: 'ok' };
}

/**
 * Applies a category's dependency on another category. A category with its
 * own configuration in order still can't run when what it depends on
 * can't, so an unmet gate overrides an otherwise-ok own result. A gate that
 * failed for a non-missing reason ('other') propagates as 'other' too,
 * rather than being reported as a missing variable it never had.
 */
function applyGate(own: CategoryResult, gate: CategoryResult, gateName: CategoryName): CategoryResult {
  if (own.status !== 'ok' || gate.status === 'ok') return own;
  if (gate.status === 'missing') {
    return { status: 'missing', missingVars: gate.missingVars ?? [], gatedBy: gateName };
  }
  return { status: 'other', reason: `depends on category "${gateName}", which is not configured`, gatedBy: gateName };
}

/**
 * Resolves every category's configuration from `env` and reports which are
 * missing required variables. Categories are resolved independently of
 * their gates first (so every missing variable is visible in one pass, per
 * ADR-043 decision 4), then gating is applied (encryption gates idr,
 * storage and vc; vc gates did; storage gates renderTemplates).
 */
export function runSeedPreflight(env: NodeJS.ProcessEnv = process.env): SeedPreflightResult {
  const encryption = resolveEncryptionCategory(env);
  const idr = applyGate(resolveIdrCategory(env), encryption, 'encryption');
  const storage = applyGate(resolveStorageCategory(env), encryption, 'encryption');
  const vc = applyGate(resolveVcCategory(env), encryption, 'encryption');
  const did = applyGate(resolveDidCategory(env), vc, 'vc');
  const renderTemplates = applyGate({ status: 'ok' }, storage, 'storage');

  const categories: Record<CategoryName, CategoryResult> = { encryption, idr, storage, vc, did, renderTemplates };

  const missingByCategory: Record<string, string[]> = {};
  const otherIssuesByCategory: Record<string, string> = {};
  let hasMissing = false;
  for (const [name, result] of Object.entries(categories)) {
    if (result.status === 'missing') {
      hasMissing = true;
      missingByCategory[name] = result.missingVars ?? [];
    }
    // Collected whenever a reason is present, not only when the same
    // category is also 'missing': an 'other' category (for example,
    // divergent DATA_ENCRYPTION_KEY/SERVICE_ENCRYPTION_KEY values) carries
    // its own reason with no missing variable attached, and an unrelated
    // missing variable elsewhere must not make that reason disappear from
    // the run's record.
    if (result.reason) otherIssuesByCategory[name] = result.reason;
  }

  return { categories, missingByCategory, otherIssuesByCategory, hasMissing };
}

/**
 * One structured summary emitted exactly once on every seed exit path,
 * a successful completion, a mid-run failure, or the default-mode
 * preflight abort alike (ADR-043 decision 6). A category that completed
 * only some of its work (for example, some but not all render templates
 * uploaded because a template file was missing) is reported under
 * `categoriesPartial` rather than `categoriesSeeded`, with what was
 * skipped named in `partialDetails`, so the summary never claims a
 * category fully seeded when it did not.
 */
export interface SeedRunSummary {
  mode: 'default' | 'partial';
  categoriesSeeded: string[];
  categoriesPartial: string[];
  categoriesSkipped: string[];
  categoriesNotRun: string[];
  missingVariables: Record<string, string[]>;
  /**
   * A category can be 'missing' and also have an unrelated, invalid value
   * in another field (a malformed URL alongside an absent key). Reported
   * here, keyed by category, so `SeedConfigurationError`'s message names
   * both problems in the same boot cycle rather than only the missing one.
   */
  invalidSiblings: Record<string, string>;
  partialDetails: Record<string, string[]>;
}

/**
 * The parts of the run that carry no gated configuration (no required
 * environment variable, so preflight never resolves a status for them)
 * but that `main()` still executes and that can still complete only
 * partially: the system tenant upsert, the core data model rows, and the
 * deployer-provided custom seed. Tracked in the summary alongside the
 * gated `ExecutionCategoryName`s so the record covers the whole run, not
 * only the categories a missing variable can gate.
 */
export type AlwaysRunCategoryName = 'tenant' | 'dataModels' | 'customSeed';

export const ALWAYS_RUN_CATEGORIES: AlwaysRunCategoryName[] = ['tenant', 'dataModels', 'customSeed'];

/** Every category the summary reports on: the gated ones plus the always-run ones. */
export type SummaryCategoryName = ExecutionCategoryName | AlwaysRunCategoryName;

/** Whether a category fully completed, completed some of its work, or did not run. */
export type CategoryOutcome = 'seeded' | 'partial' | 'skipped';

/**
 * Builds the one structured summary `seed.ts`'s `main()` emits on every
 * exit path (ADR-043 decision 6): a successful completion, a mid-run
 * failure, and (separately, via `SeedConfigurationError`) the default-mode
 * preflight abort all report through this same shape. Exported and pure
 * (no logging, no I/O) so its contents can be unit-tested directly against
 * the outcome shapes `main()` can produce, rather than only observable by
 * spying on a log call — the extraction the two prior review findings
 * (the summary skipped on a mid-run failure, and a partially-completed
 * category reported as fully seeded) point back to as the root cause.
 */
export function buildOutcomeSummary(
  mode: SeedRunSummary['mode'],
  missingVariables: Record<string, string[]>,
  outcomes: Record<SummaryCategoryName, CategoryOutcome>,
  partialDetails: Record<string, string[]>,
  invalidSiblings: Record<string, string> = {},
  notRun: SummaryCategoryName[] = [],
): SeedRunSummary {
  const categoriesSeeded: string[] = [];
  const categoriesPartial: string[] = [];
  const categoriesSkipped: string[] = [];
  const categoriesNotRun: string[] = [];
  const notRunSet = new Set(notRun);
  for (const category of [...EXECUTION_CATEGORIES, ...ALWAYS_RUN_CATEGORIES] as SummaryCategoryName[]) {
    if (outcomes[category] === 'seeded') categoriesSeeded.push(category);
    else if (outcomes[category] === 'partial') categoriesPartial.push(category);
    // A category still at its default 'skipped' outcome is only genuinely
    // "skipped" when the run reached the point of deciding not to run it
    // (a gate it depends on was unmet). One never reached at all, because
    // an earlier, unrelated failure aborted the run first, is reported as
    // 'notRun' instead, so a divergent-key failure before the tenant
    // upsert does not mislabel every later category "skipped".
    else if (notRunSet.has(category)) categoriesNotRun.push(category);
    else categoriesSkipped.push(category);
  }
  return {
    mode,
    categoriesSeeded,
    categoriesPartial,
    categoriesSkipped,
    categoriesNotRun,
    missingVariables,
    invalidSiblings,
    partialDetails,
  };
}

/**
 * Thrown when the seed aborts in default mode because a category it was
 * asked to seed is missing required configuration (ADR-043 decision 1 and
 * 3). Carries the same summary the seed would otherwise have logged on
 * success, so the aggregate failure and a healthy run report identically.
 */
export class SeedConfigurationError extends Error {
  readonly summary: SeedRunSummary;

  constructor(summary: SeedRunSummary) {
    // A category's invalid sibling (a malformed value alongside its
    // missing variable) is named in the same line: fixing only the
    // missing variable, redeploying, and discovering the typo on the next
    // boot is exactly the two-cycle cost decision 4 already avoids for
    // multiple missing variables.
    const missingLines = Object.entries(summary.missingVariables).map(([category, vars]) => {
      const invalidSibling = summary.invalidSiblings[category];
      const suffix = invalidSibling ? ` (also: ${invalidSibling})` : '';
      return `  - ${category}: ${vars.join(', ')}${suffix}`;
    });
    // A category can carry a reason (for example, divergent
    // DATA_ENCRYPTION_KEY/SERVICE_ENCRYPTION_KEY values) without itself
    // having a missing variable, so it never appears in the loop above.
    // Listed here on its own line, so an unrelated missing variable
    // elsewhere never makes that reason vanish from the abort message.
    const standaloneOtherLines = Object.entries(summary.invalidSiblings)
      .filter(([category]) => !(category in summary.missingVariables))
      .map(([category, reason]) => `  - ${category}: ${reason}`);
    const lines = [...missingLines, ...standaloneOtherLines].join('\n');
    super(
      'Seed cannot run: required configuration is missing for one or more categories.\n' +
        `${lines}\n` +
        'Set the missing variables above, or set SEED_ALLOW_PARTIAL=true to seed the categories that are ' +
        'configured and skip the rest.',
    );
    this.name = 'SeedConfigurationError';
    this.summary = summary;
  }
}
