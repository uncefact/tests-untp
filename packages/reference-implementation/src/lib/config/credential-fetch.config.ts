const DEFAULT_MAX_RESPONSE_SIZE = 10_485_760;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;

type FetchSettingPair = {
  oldName: string;
  newName: string;
};

type ResolvedFetchSetting = {
  raw: string | undefined;
  deprecatedName: string | undefined;
};

const FETCH_SETTING_PAIRS: readonly FetchSettingPair[] = [
  { oldName: 'VERIFY_ALLOW_PRIVATE_URLS', newName: 'FETCH_ALLOW_PRIVATE_URLS' },
  { oldName: 'VERIFY_MAX_CREDENTIAL_SIZE', newName: 'FETCH_MAX_RESPONSE_SIZE' },
  { oldName: 'VERIFY_FETCH_TIMEOUT_MS', newName: 'FETCH_TIMEOUT_MS' },
];

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

  if (newIsSet) return { raw: newValue, deprecatedName: undefined };
  if (oldIsSet) return { raw: oldValue, deprecatedName: pair.oldName };
  return { raw: undefined, deprecatedName: undefined };
}

export function resolveFetchAllowPrivateUrls(
  env: Record<string, string | undefined> = process.env,
): ResolvedFetchSetting {
  return resolveFetchSetting(env, FETCH_SETTING_PAIRS[0]);
}

/**
 * Exact string comparison is intentional: only lowercase `true` enables the
 * development relaxation. The old name remains a supported fallback during
 * RI v0.5, with the removal planned for RI v0.6 (#992).
 */
export function readFetchAllowPrivateUrls(env: Record<string, string | undefined> = process.env): boolean {
  return resolveFetchAllowPrivateUrls(env).raw === 'true';
}

export function readFetchMaxResponseSize(env: Record<string, string | undefined> = process.env): number {
  const raw = resolveFetchSetting(env, FETCH_SETTING_PAIRS[1]).raw;
  if (raw === undefined) return DEFAULT_MAX_RESPONSE_SIZE;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESPONSE_SIZE;
}

export function readFetchTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const pair = FETCH_SETTING_PAIRS[2];
  const resolved = resolveFetchSetting(env, pair);
  if (resolved.raw === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(resolved.raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(
      `${
        resolved.deprecatedName ?? pair.newName
      } must be a positive integer number of milliseconds no greater than ${MAX_TIMEOUT_MS} when set; fix or unset it (unset uses ${DEFAULT_TIMEOUT_MS}).`,
    );
  }
  return parsed;
}

export function validateFetchSettingsOnBoot(
  logger: { warn(message: string): void },
  env: Record<string, string | undefined> = process.env,
): void {
  readFetchAllowPrivateUrls(env);
  readFetchMaxResponseSize(env);
  readFetchTimeoutMs(env);

  for (const pair of FETCH_SETTING_PAIRS) {
    const resolved = resolveFetchSetting(env, pair);
    if (resolved.deprecatedName !== undefined) {
      logger.warn(
        `${resolved.deprecatedName} was renamed to ${pair.newName} in v0.5 and will stop being read in v0.6. Rename ${resolved.deprecatedName} to ${pair.newName}, keeping its value, and restart.`,
      );
    }
  }
}
