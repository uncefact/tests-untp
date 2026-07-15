/**
 * OpenTelemetry auto-instrumentation configuration.
 *
 * `@opentelemetry/auto-instrumentations-node` covers HTTP, fetch,
 * Next.js, Prisma, and other common libraries out of the box. Its `fs`
 * instrumentation is disabled here by default: every filesystem call
 * Next.js and Node make internally becomes a span, which produces a
 * high-cardinality, low-value flood that drowns the request-level
 * traces the walking skeleton exists to show (see #640).
 *
 * Extracted from `instrumentation.node.ts` so the configuration can be
 * unit-tested without standing up the SDK, mirroring `resource.ts`.
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

/**
 * Options for {@link buildInstrumentations}.
 */
export interface BuildInstrumentationsOptions {
  /** Re-enables the `fs` instrumentation. Defaults to `false`. */
  enableFsInstrumentation?: boolean;
}

/**
 * Build the auto-instrumentation list for the Node SDK.
 *
 * The return type is inferred from `getNodeAutoInstrumentations` itself
 * rather than importing `Instrumentation` from `@opentelemetry/instrumentation`
 * directly: that package is a transitive dependency reachable only through
 * `@opentelemetry/sdk-node`, not one this package declares itself.
 *
 * @param options Optional overrides. Pass `{ enableFsInstrumentation: true }`
 *   to restore `fs` spans, e.g. when diagnosing filesystem-level issues locally.
 * @returns The instrumentation instances to pass to `NodeSDK`.
 */
export function buildInstrumentations(
  options: BuildInstrumentationsOptions = {},
): ReturnType<typeof getNodeAutoInstrumentations> {
  return getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: options.enableFsInstrumentation ?? false },
  });
}
