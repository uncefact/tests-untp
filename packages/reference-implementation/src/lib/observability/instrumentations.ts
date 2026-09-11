/**
 * OpenTelemetry auto-instrumentation configuration.
 *
 * `@opentelemetry/auto-instrumentations-node` covers HTTP, `fetch`
 * (undici), `pg` and other common libraries out of the box. It does
 * not cover Prisma (that is the separate `@prisma/instrumentation`, not
 * installed), so there are no Prisma spans. Next.js spans (`next.js` scope)
 * come from Next's own tracer in the web process, not from this list. Two
 * instrumentations are disabled here: `fs`, because every filesystem call
 * Next.js and Node make internally becomes a span, which produces a
 * high-cardinality, low-value flood that drowns the request-level
 * traces the walking skeleton exists to show (see #640); and `pino`,
 * because log-to-trace correlation is supplied by the logger's own mixin
 * (`traceContextProvider` on the services logger), so there is one
 * enrichment mechanism and one field naming.
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
    // The logger mixin owns trace fields and their camelCase names. Running
    // Pino auto-instrumentation as well would add a second set of fields.
    '@opentelemetry/instrumentation-pino': { enabled: false },
    '@opentelemetry/instrumentation-fs': { enabled: options.enableFsInstrumentation ?? false },
  });
}
