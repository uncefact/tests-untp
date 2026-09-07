/**
 * BUNDLED_ARTEFACTS_FALLBACK controls whether a bundled UNTP or VCDM schema
 * or context stands in when its fetch from the publishing host fails (see
 * uncefact/tests-untp#1006). On by default, because the artefacts are
 * immutable once published and an outage at their host should not fail
 * issuance. `false` restores the previous behaviour, where every fetch
 * failure is reported to the caller. Unset or blank means on; any value other
 * than `true` or `false` throws, surfaced at process boot
 * (instrumentation.node.ts), so a typo fails the container start instead of
 * silently running with the fallback in an unintended state.
 */
export function readBundledArtefactsFallback(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.BUNDLED_ARTEFACTS_FALLBACK;
  if (raw === undefined || raw.trim() === '') return true;
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(
    `BUNDLED_ARTEFACTS_FALLBACK must be "true" or "false" when set; fix or unset it (unset keeps the fallback on).`,
  );
}

/** Boot-time check (instrumentation.node.ts): parses the variable for its side effect only. */
export function validateBundledArtefactsFallbackOnBoot(env: Record<string, string | undefined> = process.env): void {
  readBundledArtefactsFallback(env);
}
