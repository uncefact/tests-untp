import { StructuredError } from '../structured-error.js';

/**
 * Base for every diagnostic from `@uncefact/untp-utils/node`. Catch to
 * handle any URL-validation failure generically; catch a concrete subclass
 * for specific handling.
 */
export class UrlValidationError extends StructuredError {}

/** The string passed could not be parsed as a URL by `new URL(...)`. */
export class InvalidUrlError extends UrlValidationError {
  constructor(received: string, cause: unknown) {
    super({ code: 'url.invalid', message: 'URL could not be parsed.', received, cause });
  }
}

/** The URL's scheme is not in the allowed list (default `http`, `https`). */
export class UnsupportedSchemeError extends UrlValidationError {
  constructor(scheme: string, allowedSchemes: readonly string[]) {
    super({
      code: 'url.unsupported-scheme',
      message: `URL scheme ${scheme} is not in the allowed list.`,
      received: scheme,
      expected: [...allowedSchemes],
      remediation: `Use one of: ${allowedSchemes.join(', ')}.`,
    });
  }
}

/**
 * The hostname is a known private/local name (`localhost`, `*.localhost`,
 * `*.local`, `*.internal`, etc.), an IP literal in a non-public range, or
 * empty.
 */
export class PrivateHostnameError extends UrlValidationError {
  constructor(hostname: string) {
    super({
      code: 'url.private-hostname',
      message: `Hostname ${hostname || '(empty)'} names a private or local resource.`,
      received: hostname,
      remediation: 'Use a publicly-routable hostname.',
    });
  }
}

/**
 * DNS resolution rejected (`ENOTFOUND`, `EAI_AGAIN`, etc.), or the resolver
 * returned a record whose address is unparseable or contradicts its claimed
 * family; contradictory resolver metadata is treated as a failed resolution
 * rather than silently reconciled.
 */
export class ResolutionFailedError extends UrlValidationError {
  constructor(hostname: string, cause: unknown) {
    super({
      code: 'url.resolution-failed',
      message: `DNS resolution failed for ${hostname}.`,
      received: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}

/** DNS resolution succeeded but returned no addresses. */
export class ResolutionEmptyError extends UrlValidationError {
  constructor(hostname: string) {
    super({
      code: 'url.resolution-empty',
      message: `DNS resolver returned no addresses for ${hostname}.`,
      received: hostname,
    });
  }
}

/**
 * At least one resolved IP is in a private / loopback / link-local /
 * cloud-metadata range. The full list is exposed on
 * {@link resolvedAddresses} for triage.
 */
export class PrivateAddressError extends UrlValidationError {
  readonly resolvedAddresses: readonly string[];
  constructor(hostname: string, resolvedAddresses: readonly string[]) {
    super({
      code: 'url.private-address',
      message: `Hostname ${hostname} resolved to a private address.`,
      received: resolvedAddresses,
      remediation: 'Verify the hostname does not resolve to private or reserved network space.',
    });
    this.resolvedAddresses = resolvedAddresses;
  }
}
