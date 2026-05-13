/**
 * OpenTelemetry resource builder.
 *
 * Constructs the {@link Resource} that every emitted telemetry signal
 * inherits. Resource attributes are the segregation mechanism the
 * shared observability stack relies on (ADR 018), so the values here
 * are load-bearing: a wrong `service.name` or `deployment.environment`
 * will silently break dashboards.
 *
 * Extracted from `instrumentation.node.ts` so it can be unit-tested
 * without standing up the SDK.
 */
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { Resource } from '@opentelemetry/resources';

import pkg from '../../../package.json';

const SERVICE_NAME = 'reference-implementation';
const DEFAULT_ENVIRONMENT = 'local';

/**
 * Options for {@link buildResource}. Each field has a sensible default
 * derived from the process environment or the package's own
 * `package.json`; tests use this to inject specific values. An empty
 * or whitespace-only string is treated as absent so misconfigured
 * deployments that ship `DEPLOYMENT_ENVIRONMENT=` fall back to the
 * default rather than tagging telemetry with an empty environment.
 */
export interface BuildResourceOptions {
  /** Overrides `process.env.DEPLOYMENT_ENVIRONMENT`. */
  deploymentEnvironment?: string;
  /** Overrides the version read from `package.json`. */
  serviceVersion?: string;
}

/**
 * Build the OpenTelemetry {@link Resource} for the reference
 * implementation.
 *
 * Attribute keys are the OpenTelemetry semantic conventions. The
 * `deployment.environment.name` key is the modern (1.27+) replacement
 * for the deprecated `deployment.environment`; the shared stack
 * indexes on the new key.
 *
 * @param options Optional overrides, primarily for tests.
 * @returns A resource carrying `service.name`, `service.version`,
 *   and `deployment.environment.name`.
 */
export function buildResource(options: BuildResourceOptions = {}): Resource {
  const serviceVersion = firstNonEmpty(options.serviceVersion) ?? pkg.version;
  const deploymentEnvironment =
    firstNonEmpty(options.deploymentEnvironment) ??
    firstNonEmpty(process.env.DEPLOYMENT_ENVIRONMENT) ??
    DEFAULT_ENVIRONMENT;

  return resourceFromAttributes({
    'service.name': SERVICE_NAME,
    'service.version': serviceVersion,
    'deployment.environment.name': deploymentEnvironment,
  });
}

function firstNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
