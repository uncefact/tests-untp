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

const DEFAULT_SERVICE_NAME = 'reference-implementation';
const DEFAULT_ENVIRONMENT = 'local';

/**
 * Options for {@link buildResource}. Each field has a sensible default
 * derived from the process environment or the package's own
 * `package.json`; tests use this to inject specific values. An empty
 * or whitespace-only string is treated as absent so misconfigured
 * deployments that ship `DEPLOYMENT_ENVIRONMENT=` or `OTEL_SERVICE_NAME=`
 * (which the compose file forwards even when unset on the host) fall back
 * to the default rather than tagging telemetry with an empty value.
 */
export interface BuildResourceOptions {
  /** Overrides `process.env.DEPLOYMENT_ENVIRONMENT`. */
  deploymentEnvironment?: string;
  /** Overrides `process.env.OTEL_SERVICE_NAME`. */
  serviceName?: string;
  /** Overrides the version read from `package.json`. */
  serviceVersion?: string;
}

/**
 * Resolve the service name: an explicit override, else `OTEL_SERVICE_NAME`,
 * else the default. Empty and whitespace-only values are absent, and the
 * result is trimmed, so the name emitted matches the name operators filter
 * dashboards by.
 */
export function resolveServiceName(override?: string): string {
  return firstNonEmpty(override) ?? firstNonEmpty(process.env.OTEL_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME;
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
 * `service.name` is resolved by {@link resolveServiceName} and must ALSO be
 * passed to the NodeSDK as its `serviceName` option (see
 * `instrumentation.node.ts`): the SDK merges its env detector's attributes
 * over this resource, then merges `serviceName` last, so only that option
 * makes the resolved name authoritative over a padded `OTEL_SERVICE_NAME`
 * or a `service.name` set through `OTEL_RESOURCE_ATTRIBUTES`.
 *
 * @param options Optional overrides, primarily for tests.
 * @returns A resource carrying `service.name`, `service.version`,
 *   and `deployment.environment.name`.
 */
export function buildResource(options: BuildResourceOptions = {}): Resource {
  const serviceName = resolveServiceName(options.serviceName);
  const serviceVersion = firstNonEmpty(options.serviceVersion) ?? pkg.version;
  const deploymentEnvironment =
    firstNonEmpty(options.deploymentEnvironment) ??
    firstNonEmpty(process.env.DEPLOYMENT_ENVIRONMENT) ??
    DEFAULT_ENVIRONMENT;

  return resourceFromAttributes({
    'service.name': serviceName,
    'service.version': serviceVersion,
    'deployment.environment.name': deploymentEnvironment,
  });
}

function firstNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
