/**
 * Credential family layer over the shared per-instance model (ADR-041).
 *
 * The shared model in artefactCollection.ts owns the generic mechanics; this file owns the
 * credential-specific parts: the content hash that identifies a credential instance, when its
 * result is terminal, its card title and subtitle copy, the detected type used to group instances
 * (#810), and the worst-of rollup shown on a type group's header and reused for a single
 * instance's own overall status.
 */

import { hashContent } from '@/lib/hash';
import { detectCredentialType, detectVersion } from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import type { Credential, StoredCredential, TestStep } from '@/types';
import { TERMINAL_STATUSES, TestCaseStatus } from '../../constants';

/**
 * A credential instance's identity is the content hash of its decoded document, never the
 * enveloping JWT, so an enveloped credential keys on its document rather than the envelope
 * string.
 */
export function credentialContentHash(decoded: Record<string, unknown>): string {
  return hashContent(decoded);
}

/**
 * A credential's pipeline is terminal once every step has settled. Uses the shared
 * `TERMINAL_STATUSES` so the remove gate agrees with report readiness on whether WARNING counts as
 * settled (they must, or a finished instance could be readable in the report yet non-removable).
 */
export function credentialIsTerminal(steps: TestStep[]): boolean {
  return steps.length > 0 && steps.every((step) => TERMINAL_STATUSES.includes(step.status));
}

/**
 * The detected type used to group instances: an extension's resolved core type takes precedence
 * over the raw detected type, matching the ingest check in `page.tsx`, so a re-ingest whose
 * detected type changed moves the same instance between groups rather than splitting identity.
 */
export function credentialGroupType(decoded: Record<string, unknown>): string {
  const extension = detectExtension(decoded);
  if (extension) return extension.core.type;
  return detectCredentialType(decoded as Credential);
}

/** Splits a PascalCase credential type into spaced words, e.g. "Digital Product Passport". */
export function credentialTypeLabel(type: string): string {
  return type.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * The group header label: the spaced type, pluralised when the group holds more than one instance.
 * Every UNTP credential type ends in a word that pluralises with a trailing "s" (Passport, Credential,
 * Record, Anchor, Event), so a simple suffix is correct for the grouped types.
 */
export function credentialGroupLabel(type: string, count: number): string {
  const label = credentialTypeLabel(type);
  return count === 1 ? label : `${label}s`;
}

/** Instance row title: the filename, or a URL's final path segment, else the detected type. Never the raw URL. */
export function credentialTitle(stored: StoredCredential): string {
  const source = stored.source;
  if (source?.kind === 'url') {
    const segment = finalPathSegment(source.url);
    if (segment) return segment;
  }
  if (source?.kind === 'file' && source.filename.length > 0) return source.filename;

  return credentialTypeLabel(credentialGroupType(stored.decoded));
}

/**
 * Instance row subtitle: the detected version and issuer, with the source host first for a
 * URL-sourced instance. When the credential is a known extension, the version slot names the
 * extension itself (type and version, e.g. "DigitalLivestockPassport v0.4.0") so the row shows the
 * specific extension that was validated, not just the core UNTP version of the group it sits under.
 */
export function credentialSubtitle(stored: StoredCredential): string {
  const decoded = stored.decoded;
  const extension = detectExtension(decoded);
  const versionLabel = extension ? extensionLabel(extension.extension) : coreVersionLabel(detectVersion(decoded));
  const issuer = credentialIssuerId(decoded);

  const parts: string[] = [];
  const source = stored.source;
  if (source?.kind === 'url') {
    const host = hostOf(source.url);
    if (host) parts.push(host);
  }
  parts.push(versionLabel);
  if (issuer) parts.push(issuer);

  return parts.join(' · ');
}

function coreVersionLabel(version: string): string {
  return version && version !== 'unknown' ? `v${version}` : 'unknown version';
}

function extensionLabel(extension: { type: string; version: string }): string {
  const suffix = extension.version && extension.version !== 'unknown' ? ` v${extension.version}` : '';
  return `${extension.type}${suffix}`;
}

/**
 * Extensible worst-of rollup, ordered worst first. Reduces either a single instance's own step
 * statuses to its overall status, or a type group's per-instance statuses to the group rollup, so
 * a future bucket (#813 adds an amber "blocked" state) is added as one more entry here rather than
 * by rewriting a cascade of if/else across both call sites.
 */
const ROLLUP_BUCKETS: { matches: TestCaseStatus[]; canonical: TestCaseStatus }[] = [
  { matches: [TestCaseStatus.FAILURE], canonical: TestCaseStatus.FAILURE },
  { matches: [TestCaseStatus.PENDING, TestCaseStatus.IN_PROGRESS], canonical: TestCaseStatus.IN_PROGRESS },
  { matches: [TestCaseStatus.SUCCESS, TestCaseStatus.WARNING], canonical: TestCaseStatus.SUCCESS },
];

export function worstStatus(statuses: TestCaseStatus[]): TestCaseStatus {
  if (statuses.length === 0) return TestCaseStatus.PENDING;
  for (const bucket of ROLLUP_BUCKETS) {
    if (statuses.some((status) => bucket.matches.includes(status))) return bucket.canonical;
  }
  return TestCaseStatus.FAILURE;
}

/** A single instance's own overall status, from its own steps (`undefined` before its run starts). */
export function instanceStatus(steps: TestStep[] | undefined): TestCaseStatus {
  if (!steps || steps.length === 0) return TestCaseStatus.PENDING;
  return worstStatus(steps.map((step) => step.status));
}

function credentialIssuerId(decoded: Record<string, unknown>): string | undefined {
  const issuer = (decoded as { issuer?: unknown }).issuer;
  if (typeof issuer === 'string' && issuer.length > 0) return issuer;
  if (issuer && typeof issuer === 'object' && typeof (issuer as { id?: unknown }).id === 'string') {
    return (issuer as { id: string }).id;
  }
  return undefined;
}

function hostOf(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return undefined;
  }
}

function finalPathSegment(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : url.hostname;
  } catch {
    return undefined;
  }
}
