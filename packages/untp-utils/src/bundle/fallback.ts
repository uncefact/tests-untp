/** Reported to the consumer each time a bundled artefact stands in for a failed fetch. */
export interface BundledFallbackEvent {
  /** The URL whose fetch failed. */
  url: string;
  /** The error the fetch failed with; the consumer's log should carry it. */
  cause: unknown;
}

/**
 * Options shared by the loaders that can fall back to the bundled artefacts.
 * The fallback is on by default: the artefacts are versioned and immutable
 * once published, so a running service should not depend on the publishing
 * host being up to read one. Set `bundledFallback: false` to make every
 * fetch failure surface as it did before the bundle existed.
 */
export interface BundledFallbackOptions {
  bundledFallback?: boolean;
  /** Called when a fetch failed and the bundled copy was served instead. */
  onBundledFallback?: (event: BundledFallbackEvent) => void;
}

/**
 * Runs `fetcher`; on failure, serves the bundled artefact for `url` when the
 * fallback is enabled and the bundle carries it, otherwise rethrows.
 */
export async function withBundledFallback<T extends object>(
  url: string,
  options: BundledFallbackOptions | undefined,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    return await fetcher();
  } catch (cause) {
    if (options?.bundledFallback === false) throw cause;
    const { findBundledArtefact } = await import('./lookup.js');
    const bundled = await findBundledArtefact(url);
    if (bundled === undefined) throw cause;
    options?.onBundledFallback?.({ url, cause });
    return bundled as T;
  }
}
