import type { ResolveFailureStatus } from './types.js';

/**
 * Returned (not thrown) on the failure branch of a
 * {@link resolveAndParseConformityScheme} run. Carries the underlying gate
 * error via `Error.cause`, the source URL for triage, and the
 * {@link ResolveFailureStatus} the caller maps to the persisted
 * `lastFetchStatus` column.
 *
 * Consumers should branch on `.status` (a string union), not on
 * `instanceof StructuredError`. The `cause` chain carries the original gate
 * error and should be forwarded to structured loggers.
 */
export class ConformitySchemeResolveError extends Error {
  readonly code: string;
  readonly status: ResolveFailureStatus;
  readonly sourceUrl: string;
  constructor(args: { status: ResolveFailureStatus; sourceUrl: string; cause: unknown }) {
    super(`Resolve-and-parse of ${args.sourceUrl} failed at the ${args.status} stage.`, { cause: args.cause });
    this.name = 'ConformitySchemeResolveError';
    this.code = `conformity-scheme.resolve-failed.${args.status.toLowerCase().replace(/_/g, '-')}`;
    this.status = args.status;
    this.sourceUrl = args.sourceUrl;
  }
}
