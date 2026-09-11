import { z } from 'zod';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
  LibraryRecordOrigin,
  type CheckRun,
  type LibraryRecord,
} from '@/lib/prisma/generated';
import {
  DecryptionKeyEnvelopeMalformedError,
  DecryptionKeyUnwrapError,
  EncryptionServiceUnavailableError,
  looksEnvelopeLikeButInvalid,
} from '@/lib/credentials/decryption-key-protection';
import { CHECK_NAMES, BLOCKING_CHECKS, isNativeMasked, type LibraryCheckName as CheckName } from './check-rules';
import type { ExternalCredentialRecord } from '@/lib/prisma/repositories/external-credential.repository';
import { type LibraryRecordDetailView, type NativeLibraryRecordView } from './library-record-view';
import { StructuredError } from '@uncefact/untp-utils';

/**
 * The library surface's outbound shape for a credential record, as the
 * discovery contract's `CredentialRecord` component defines it, built by one
 * schema that both checks every envelope at runtime and generates the
 * published component (ADR-053 decision 7). The database keeps the check-run
 * vocabulary (`CheckRun`, `PENDING`, `PASS`); the wire keeps the contract's
 * verification vocabulary (`verification`, `pending`, `pass`), and this
 * module is the one place the two meet.
 */

const checkResultSchema = z.enum(['pass', 'fail', 'not_run']);

/** The core credential kind values published by the keyless library record. */
export const credentialTypeSchema = z.nativeEnum(CoreCredentialType);

/** The two origins published by the keyless library record. */
export const originSchema = z.enum(['native', 'external']);
export type LibraryOrigin = z.infer<typeof originSchema>;

/** The summary values a list caller may filter on. */
export const verificationSummarySchema = z.enum(['pending', 'verified', 'not_conformant', 'failed']);
export type VerificationSummary = z.infer<typeof verificationSummarySchema>;

export const verificationChecksSchema = z
  .object({
    retrieval: checkResultSchema,
    decryption: checkResultSchema,
    digest: checkResultSchema,
    proof: checkResultSchema,
    status: checkResultSchema,
    temporal: checkResultSchema.describe('Recorded as evidence; never part of the blocking set.'),
    schemaConformance: checkResultSchema.describe(
      'Advisory only; checks the system core schema for the stored type and version, then JSON-LD expansion; extension schemas are not checked.',
    ),
  })
  .strict()
  .describe('All seven checks are always present; `not_run` covers both "did not apply" and "did not execute".');

export type VerificationChecks = z.infer<typeof verificationChecksSchema>;

// Shared check sets are defined beside the roster for the projector and list SQL.
export { BLOCKING_CHECKS, NATIVE_MASKED_CHECKS } from './check-rules';

/**
 * The contract's derivation rule for a complete generation: any blocking
 * `fail` is `not_conformant`; otherwise `verified` only when the proof
 * check passed, and `not_conformant` when it did not run.
 *
 * `verified` means the credential is authentic, untampered with and not
 * revoked. Proof is the only check that establishes the first two, so a
 * generation whose proof was never established cannot be `verified` however
 * many other checks ran: a verifier that stopped at the validity window, or
 * a run that never reached the verifier, must not read as a verified
 * credential. A revoked credential fails the blocking `status` check and is
 * `not_conformant` by the first clause. Native masking blanks acquisition
 * and custody checks but never proof, so a native and an external record
 * with the same worker outcome still read the same.
 */
export function deriveCompleteSummary(checks: VerificationChecks): 'verified' | 'not_conformant' {
  if (BLOCKING_CHECKS.some((name) => checks[name] === 'fail')) return 'not_conformant';
  return checks.proof === 'pass' ? 'verified' : 'not_conformant';
}

const envelopeBase = {
  generation: z.number().int().min(1),
  requestedAt: z.string().datetime(),
  checks: verificationChecksSchema,
};

const failureCodeSchema = z.nativeEnum(CheckRunFailureCode);

const pendingEnvelopeSchema = z
  .object({ ...envelopeBase, state: z.literal('pending'), summary: z.literal('pending') })
  .strict();

/**
 * Present together or not at all on a settled envelope, which the union's
 * refinement enforces. They are absent, rather than null, when no comparison
 * was attempted, which is every native generation and every external
 * generation created before re-verification existed.
 */
const settledFreshnessFields = {
  sourceChanged: z.boolean().nullable().optional(),
  lastSourceCheckAt: z.string().datetime().optional(),
};

const completeEnvelopeSchema = z
  .object({
    ...envelopeBase,
    state: z.literal('complete'),
    completedAt: z.string().datetime(),
    summary: z.enum(['verified', 'not_conformant']),
    ...settledFreshnessFields,
  })
  .strict();

const failedEnvelopeSchema = z
  .object({
    ...envelopeBase,
    state: z.literal('failed'),
    completedAt: z.string().datetime(),
    summary: z.literal('failed'),
    ...settledFreshnessFields,
    failure: z
      .object({
        code: failureCodeSchema,
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

const verificationEnvelopeDescription =
  'Discriminated by `state`. A `pending` envelope has neither `completedAt` nor `failure`; `complete` has `completedAt` and no `failure`; `failed` has both. A `complete` summary is derived from the published checks. Any failed blocking check (retrieval, decryption, digest, proof, status) is `not_conformant`. Otherwise it is `verified` only when `proof` passed; a generation whose proof was not established is `not_conformant`. A failed `temporal` or `schemaConformance` never makes it `not_conformant`. A settled external generation that attempted a source comparison also carries `sourceChanged` and `lastSourceCheckAt`, together or not at all. `sourceChanged` is null when the comparison was attempted and the source could not be checked.';

/**
 * What the record schemas add to the envelope's own description, and why it
 * is not on {@link verificationEnvelopeSchema} itself: the register route
 * returns that same envelope for a generation 1 that really did run, so the
 * qualification only holds once the origin is known.
 */
const nativeIssuanceAssertionNote =
  'For a native record, generation 1 is an issuance assertion rather than an executed run. `proof` reads `pass` because this service signed the artefact moments earlier, and no check was run. Generation 2 onward is executed. Every generation of an external record is executed.';

/**
 * The three settlement variants, discriminated by `state`; each fixes which
 * `summary` values it permits and whether `completedAt` and `failure` are
 * present, so a pending envelope with a failure, or a complete one with a
 * summary its checks do not support, cannot be built.
 */
export const verificationEnvelopeSchema = z
  .discriminatedUnion('state', [pendingEnvelopeSchema, completeEnvelopeSchema, failedEnvelopeSchema])
  .superRefine((envelope, ctx) => {
    if (envelope.state === 'complete' && envelope.summary !== deriveCompleteSummary(envelope.checks)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary'],
        message:
          'summary must be derived from the published checks: not_conformant when a blocking check failed or proof did not pass, otherwise verified',
      });
    }
    if (envelope.state === 'pending') return;
    // The timestamp decides whether the pair is published, so a result
    // without one would be recorded and then hidden, and a timestamp without
    // a result would say a comparison was made and refuse to say what it
    // found. Neither half is publishable alone.
    if ('sourceChanged' in envelope !== (envelope.lastSourceCheckAt !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lastSourceCheckAt'],
        message: 'sourceChanged and lastSourceCheckAt are present together or not at all',
      });
    }
  })
  .describe(verificationEnvelopeDescription);

export type VerificationEnvelope = z.infer<typeof verificationEnvelopeSchema>;

const nullableString = z.string().nullable();

export const credentialRecordWarningSchema = z.discriminatedUnion('code', [
  z
    .object({
      code: z.literal('DUPLICATE_CONTENT'),
      message: z.string(),
      relatedRecordId: z.string().describe('The id of the existing record this one matches.'),
    })
    .strict(),
  z
    .object({
      code: z.enum(['DECLARED_TYPE_MISMATCH', 'SCHEMA_CONFORMANCE_ADVISORY', 'DECRYPTION_KEY_UNUSED']),
      message: z.string(),
    })
    .strict(),
]);

export type CredentialRecordWarning = z.infer<typeof credentialRecordWarningSchema>;

/**
 * The keyless warnings plus the one code only a detail response may carry.
 * Composed from the shared union's own members rather than restated, so a code
 * added to the record contract reaches the detail contract with it instead of
 * leaving two hand-kept lists to drift (ADR-057 decision 4).
 */
const credentialRecordDetailWarningSchema = z.discriminatedUnion('code', [
  ...credentialRecordWarningSchema.options,
  z
    .object({
      code: z.literal('DECRYPTION_KEY_UNAVAILABLE'),
      message: z.string(),
    })
    .strict(),
]);

type CredentialRecordDetailWarning = z.infer<typeof credentialRecordDetailWarningSchema>;

export const credentialRecordSchema = z
  .object({
    id: z.string().describe('Opaque; never parse or derive meaning from it.'),
    origin: originSchema,
    credential: z
      .object({
        name: nullableString,
        credentialType: credentialTypeSchema.nullable(),
        issuerName: nullableString,
        issuerDid: nullableString,
        subjectName: nullableString,
        subjectId: nullableString,
        validFrom: z.string().datetime().nullable(),
        validUntil: z.string().datetime().nullable(),
      })
      .strict()
      .describe('Read from the signed artefact once extraction succeeds; every field null until then.'),
    annotations: z
      .object({
        annotationVersion: z.number().int().min(1),
        displayName: z.string(),
        declaredCredentialType: credentialTypeSchema,
        dateReceived: z.string().date().nullable(),
        notes: nullableString,
      })
      .strict()
      .nullable()
      .describe('Recipient-asserted fields; always present for an external record, always null for a native one.'),
    organisationId: nullableString,
    facilityId: nullableString,
    productId: nullableString,
    sourceUrl: nullableString,
    sourceDigest: nullableString.describe(
      'Multibase digest of the raw bytes as fetched, before any decryption; null until a fetch succeeded.',
    ),
    resolverUri: nullableString,
    issuedAt: z
      .string()
      .datetime()
      .nullable()
      .describe("The credential's own validFrom once extracted; not an independently verified timestamp."),
    encrypted: z
      .boolean()
      .nullable()
      .describe('Whether the fetched body was an encrypted envelope; null until a body has been observed.'),
    hasKey: z.boolean().describe('Whether this service holds a key that opens its own durable copy.'),
    verification: verificationEnvelopeSchema.describe(
      `${verificationEnvelopeDescription} ${nativeIssuanceAssertionNote}`,
    ),
    currencyStatus: z.enum(['current', 'not_yet_valid', 'expired', 'unknown']),
    detailsStatus: z.nativeEnum(CredentialDetailsStatus),
    detailsError: z.nativeEnum(CredentialDetailsError).nullable(),
    capabilities: z.object({ deletable: z.boolean(), annotatable: z.boolean(), verifiable: z.boolean() }).strict(),
    warnings: z.array(credentialRecordWarningSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type CredentialRecordResponse = z.infer<typeof credentialRecordSchema>;

export const credentialRecordDetailSchema = credentialRecordSchema
  .extend({
    hasKey: z
      .boolean()
      .describe(
        'Whether this service holds a key that opens its own durable copy. It remains true when the key is held but cannot be returned; that state has a null decryptionKey and exactly one DECRYPTION_KEY_UNAVAILABLE warning.',
      ),
    storageUri: z
      .string()
      .nullable()
      .describe(
        "The Reference Implementation's own durable-copy location. Always present for a native record; null only for an external record with no durable copy yet.",
      ),
    digestMultibase: z
      .string()
      .nullable()
      .describe(
        "The storage service's content digest for the durable copy, null whenever storageUri is null. For a copy the storage service encrypted, it covers the content before encryption. For an unencrypted copy, and for unopened ciphertext stored exactly as fetched, it covers the stored bytes. A caller fetching an encrypted copy must decrypt it before comparing.",
      ),
    decryptionKey: z
      .string()
      .nullable()
      .describe(
        "The key that opens the Reference Implementation's durable copy. Non-null exactly when hasKey is true and the key can be returned; null with exactly one DECRYPTION_KEY_UNAVAILABLE warning when the service holds a key but cannot reveal it. A non-null key always comes with a non-null storageUri.",
      ),
    warnings: z.array(credentialRecordDetailWarningSchema),
  })
  .superRefine((record, ctx) => {
    if (record.decryptionKey !== null && !record.hasKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decryptionKey'],
        message: 'decryptionKey requires hasKey',
      });
    }
    if (record.decryptionKey !== null && record.storageUri === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storageUri'],
        message: 'decryptionKey requires storageUri',
      });
    }
    if (record.storageUri === null && record.digestMultibase !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['digestMultibase'],
        message: 'digestMultibase requires storageUri',
      });
    }
    if (record.origin === 'native' && record.storageUri === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storageUri'],
        message: 'native records require storageUri',
      });
    }
    const keyUnavailableWarnings = record.warnings.filter((warning) => warning.code === 'DECRYPTION_KEY_UNAVAILABLE');
    if (record.hasKey && record.storageUri === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storageUri'],
        message: 'hasKey requires storageUri',
      });
    }
    if (record.hasKey && record.decryptionKey === null && keyUnavailableWarnings.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warnings'],
        message: 'hasKey with a null decryptionKey requires exactly one DECRYPTION_KEY_UNAVAILABLE warning',
      });
    }
    if (!record.hasKey && keyUnavailableWarnings.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warnings'],
        message: 'DECRYPTION_KEY_UNAVAILABLE requires hasKey',
      });
    }
    if (record.decryptionKey !== null && keyUnavailableWarnings.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warnings'],
        message: 'DECRYPTION_KEY_UNAVAILABLE requires a null decryptionKey',
      });
    }
  })
  .describe(
    'CredentialRecord plus required-nullable durable-copy coordinates and the receiver-side decryption key. The URI and digest are present together whenever a durable copy exists.',
  );

export type CredentialRecordDetailResponse = z.infer<typeof credentialRecordDetailSchema>;

/** A record read from the database whose rows cannot be projected: a broken invariant, never caller input. */
export class CredentialRecordProjectionError extends StructuredError {
  readonly recordId: string;
  readonly reason = 'projection' as const;

  constructor(recordId: string, detail: string) {
    super({
      code: 'library.record-projection',
      message: `Library record ${recordId} cannot be projected: ${detail}`,
    });
    this.recordId = recordId;
  }
}

function parseProjection<S extends z.ZodTypeAny>(schema: S, recordId: string, projected: unknown): z.infer<S> {
  const checked = schema.safeParse(projected);
  if (!checked.success) {
    throw new CredentialRecordProjectionError(recordId, checked.error.issues.map((issue) => issue.message).join('; '));
  }
  return checked.data;
}

const WIRE_RESULT: Record<CheckResult, VerificationChecks[CheckName]> = {
  [CheckResult.PASS]: 'pass',
  [CheckResult.FAIL]: 'fail',
  [CheckResult.NOT_RUN]: 'not_run',
};

function wireChecks(run: CheckRun, native: boolean): VerificationChecks {
  const checks = Object.fromEntries(CHECK_NAMES.map((name) => [name, WIRE_RESULT[run[name]]])) as VerificationChecks;
  if (!native) return checks;
  // Native records retain the worker's real results in the row, but the
  // public contract keeps acquisition and custody checks as not_run. The
  // executed proof, status, temporal and schemaConformance results remain
  // visible.
  return Object.fromEntries(
    CHECK_NAMES.map((name) => [name, isNativeMasked(name) ? 'not_run' : checks[name]]),
  ) as VerificationChecks;
}

function schemaConformanceWarnings(run: CheckRun | null): CredentialRecordWarning[] {
  if (
    run?.state === CheckRunState.PENDING ||
    run?.schemaConformance !== CheckResult.FAIL ||
    run.schemaConformanceMessage === null
  ) {
    return [];
  }
  return [{ code: 'SCHEMA_CONFORMANCE_ADVISORY', message: run.schemaConformanceMessage }];
}

function freshnessOf(
  run: CheckRun,
): { sourceChanged: boolean | null; lastSourceCheckAt: string } | Record<string, never> {
  if (run.lastSourceCheckAt === null) return {};
  return { sourceChanged: run.sourceChanged, lastSourceCheckAt: run.lastSourceCheckAt.toISOString() };
}

/**
 * The origin decides both projection rules at once: which checks a native
 * envelope blanks, and that only an external one publishes a source
 * comparison. Deriving them from one discriminant keeps a caller from setting
 * half the rule, which would publish a native run's custody results or drop an
 * external run's recorded comparison.
 */
function envelopeOf(run: CheckRun, options: { origin: 'native' | 'external' }): VerificationEnvelope {
  const native = options.origin === 'native';
  const base = {
    generation: run.generation,
    requestedAt: run.requestedAt.toISOString(),
    checks: wireChecks(run, native),
  };
  const freshness = native ? {} : freshnessOf(run);
  const completedAt = () => {
    if (run.completedAt === null) {
      throw new CredentialRecordProjectionError(
        run.recordId,
        `check run ${run.id} is ${run.state} with no completedAt`,
      );
    }
    return run.completedAt.toISOString();
  };
  const state: CheckRunState = run.state;
  switch (state) {
    case CheckRunState.PENDING:
      return { ...base, state: 'pending', summary: 'pending' };
    case CheckRunState.COMPLETE:
      return {
        ...base,
        ...freshness,
        state: 'complete',
        completedAt: completedAt(),
        summary: deriveCompleteSummary(base.checks),
      };
    case CheckRunState.FAILED: {
      if (run.failureCode === null || run.failureMessage === null || run.failureRetryable === null) {
        throw new CredentialRecordProjectionError(
          run.recordId,
          `check run ${run.id} is FAILED with no failure recorded`,
        );
      }
      return {
        ...base,
        ...freshness,
        state: 'failed',
        completedAt: completedAt(),
        summary: 'failed',
        failure: { code: run.failureCode, message: run.failureMessage, retryable: run.failureRetryable },
      };
    }
    default: {
      const unhandled: never = state;
      throw new CredentialRecordProjectionError(run.recordId, `check run state ${String(unhandled)} is not handled`);
    }
  }
}

/**
 * Derived on every read from both bounds against `now`, never stored
 * (the contract's `currencyStatus`): `unknown` until at least one bound has
 * been extracted, an absent bound is open-ended.
 */
export function deriveCurrencyStatus(
  validFrom: Date | null,
  validUntil: Date | null,
  now: Date,
): CredentialRecordResponse['currencyStatus'] {
  if (validFrom === null && validUntil === null) return 'unknown';
  if (validFrom !== null && now < validFrom) return 'not_yet_valid';
  if (validUntil !== null && now > validUntil) return 'expired';
  return 'current';
}

function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function isoDateTime(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function issuanceAssertionEnvelope(record: LibraryRecord): VerificationEnvelope {
  const checks: VerificationChecks = {
    retrieval: 'not_run',
    decryption: 'not_run',
    digest: 'not_run',
    proof: 'pass',
    status: 'not_run',
    temporal: 'not_run',
    schemaConformance: 'not_run',
  };
  return {
    generation: 1,
    state: 'complete',
    requestedAt: record.createdAt.toISOString(),
    completedAt: record.createdAt.toISOString(),
    checks,
    summary: deriveCompleteSummary(checks),
  };
}

/**
 * Projects a native library record onto the keyless CredentialRecord shape.
 * A stored generation 1 is refused where the record is read, so the envelope
 * here is the stored run when there is one and the synthesised issuance
 * assertion otherwise (ADR-053 decision 4).
 */
export function toNativeCredentialRecord(
  view: NativeLibraryRecordView,
  options: { now?: Date } = {},
): CredentialRecordResponse {
  const { record: parent, credential, checkRun } = view;
  const projected: CredentialRecordResponse = {
    id: parent.id,
    origin: 'native',
    credential: {
      name: parent.name,
      credentialType: parent.coreCredentialType,
      issuerName: parent.issuerName,
      issuerDid: parent.issuerDid,
      subjectName: parent.subjectName,
      subjectId: parent.subjectId,
      validFrom: isoDateTime(parent.validFrom),
      validUntil: isoDateTime(parent.validUntil),
    },
    annotations: null,
    organisationId: credential.organisationId,
    facilityId: credential.facilityId,
    productId: credential.productId,
    sourceUrl: null,
    sourceDigest: null,
    resolverUri: null,
    issuedAt: isoDateTime(parent.validFrom),
    encrypted: credential.decryptionKey !== null,
    hasKey: credential.decryptionKey !== null,
    verification: checkRun ? envelopeOf(checkRun, { origin: 'native' }) : issuanceAssertionEnvelope(parent),
    currencyStatus: deriveCurrencyStatus(parent.validFrom, parent.validUntil, options.now ?? new Date(Date.now())),
    detailsStatus: parent.detailsStatus,
    detailsError: parent.detailsError,
    capabilities: { deletable: false, annotatable: false, verifiable: true },
    warnings: schemaConformanceWarnings(checkRun),
    createdAt: parent.createdAt.toISOString(),
    updatedAt: parent.updatedAt.toISOString(),
  };
  return parseProjection(credentialRecordSchema, parent.id, projected);
}

/**
 * Projects an external record onto the contract. Every value the contract
 * lists is set here explicitly: the repository row is never serialised
 * (it carries the protected storage key, which only the detail route may
 * reveal; ADR-055 decision 5). The schema then checks the result, so a row
 * combination the contract forbids fails here, as a defect, rather than
 * reaching a caller.
 */
export function toCredentialRecord(
  record: ExternalCredentialRecord,
  options: { now?: Date } = {},
): CredentialRecordResponse {
  const now = options.now ?? new Date(Date.now());
  const { record: parent, external, checkRun } = record;
  const warnings: CredentialRecordWarning[] = schemaConformanceWarnings(checkRun);
  // The pointer is written by recovery (#957, this release) and by
  // promotion (#960, not yet landed), so this warning is currently reachable
  // only through a re-verification that recovers a record onto content
  // another record already holds.
  if (external.duplicateOfRecordId !== null) {
    warnings.push({
      code: 'DUPLICATE_CONTENT',
      message: `The credential content matches record ${external.duplicateOfRecordId}.`,
      relatedRecordId: external.duplicateOfRecordId,
    });
  }
  if (external.decryptionKeyUnused) {
    // Past tense, and about a particular past attempt rather than the record
    // as it stands. The flag is only ever set, never cleared, so a record
    // whose source later served ciphertext that a subsequent recovery opened
    // keeps this warning. A present-tense sentence ("the source is plaintext")
    // would then be asserting something no longer true.
    warnings.push({
      code: 'DECRYPTION_KEY_UNUSED',
      message: 'A supplied decryption key was not needed on an earlier attempt.',
    });
  }
  if (parent.coreCredentialType !== null && parent.coreCredentialType !== external.declaredCredentialType) {
    warnings.push({
      code: 'DECLARED_TYPE_MISMATCH',
      message: `The record was declared as ${external.declaredCredentialType} but the credential is a ${parent.coreCredentialType}.`,
    });
  }

  const projected: CredentialRecordResponse = {
    id: parent.id,
    origin: 'external',
    credential: {
      name: parent.name,
      credentialType: parent.coreCredentialType,
      issuerName: parent.issuerName,
      issuerDid: parent.issuerDid,
      subjectName: parent.subjectName,
      subjectId: parent.subjectId,
      validFrom: isoDateTime(parent.validFrom),
      validUntil: isoDateTime(parent.validUntil),
    },
    annotations: {
      annotationVersion: external.annotationVersion,
      displayName: external.displayName,
      declaredCredentialType: external.declaredCredentialType,
      dateReceived: isoDate(external.dateReceived),
      notes: external.notes,
    },
    organisationId: null,
    facilityId: null,
    productId: null,
    sourceUrl: external.sourceUrl,
    sourceDigest: external.sourceDigest,
    resolverUri: null,
    issuedAt: isoDateTime(parent.validFrom),
    encrypted: external.encrypted,
    hasKey: external.decryptionKey !== null,
    verification: envelopeOf(checkRun, { origin: 'external' }),
    currencyStatus: deriveCurrencyStatus(parent.validFrom, parent.validUntil, now),
    detailsStatus: parent.detailsStatus,
    detailsError: parent.detailsError,
    capabilities: { deletable: true, annotatable: true, verifiable: true },
    warnings,
    createdAt: parent.createdAt.toISOString(),
    updatedAt: parent.updatedAt.toISOString(),
  };
  return parseProjection(credentialRecordSchema, parent.id, projected);
}

/**
 * The stored value is never null here: a record with no key skips the
 * revealer entirely, so a null answer would have no meaning the projection
 * could express.
 */
type DetailRevealer = (stored: string) => string;

/**
 * What a caller reads on the one detail warning this projection can add.
 * Exported so the published example is anchored to the runtime value rather
 * than hand-copied beside it, where a reworded message would leave a wrong
 * example in the API document with nothing to catch it.
 */
export const DECRYPTION_KEY_UNAVAILABLE_MESSAGE =
  'The record is readable, but its stored decryption key could not be returned. Quote the record id and the x-correlation-id response header when contacting support.';

/**
 * Why a held key could not be returned. The values need different repairs and
 * the caller cannot tell them apart, so they are conveyed to the route, which
 * owns the single operator-facing event:
 *
 * - `malformed-envelope`: the stored value looks like an envelope and is not
 *   one, so the revealer was never called. One row is damaged.
 * - `key-configuration`: the revealer could not resolve the deployment's
 *   encryption service. Every protected key in the deployment is affected.
 * - `unwrap-failed`: the ciphertext would not open under the current wrapping
 *   key. This row's envelope and the deployment key disagree.
 * - `unclassified`: the revealer threw something else.
 *
 * The two reveal failures are recognised POSITIVELY, each by the class the
 * revealer raises for it, and `malformed-envelope` is recognised before any
 * reveal is attempted. A new fault on the reveal path therefore reaches the
 * operator as an unknown cause, rather than sending them to re-check a key
 * configuration that is not at fault. Each of the three carries a
 * `StructuredError` class of its own, so the operator event names it by code
 * as well as by reason; only `unclassified` can arrive without a code.
 */
export type KeyUnavailableReason = 'malformed-envelope' | 'key-configuration' | 'unwrap-failed' | 'unclassified';

/** The classified cause handed to `onKeyUnavailable`. */
export type KeyUnavailableCause = { reason: KeyUnavailableReason; error: unknown };

/**
 * Names a reveal failure by the class the revealer raises for it, never by
 * message text. Both recognised classes are declared by
 * `decryption-key-protection.ts` precisely so this classification can be
 * positive; anything else is an unknown cause and says so.
 */
function classifyRevealFailure(error: unknown): KeyUnavailableReason {
  if (error instanceof DecryptionKeyUnwrapError) return 'unwrap-failed';
  if (error instanceof EncryptionServiceUnavailableError) return 'key-configuration';
  return 'unclassified';
}

/**
 * Adds the durable-copy coordinates to either origin's keyless projection.
 * Any failure to reveal a held key, whatever its cause, leaves the record
 * readable and makes its key unavailable. The detail contract keeps
 * `hasKey: true`, clears only the returned key, keeps every warning the
 * keyless projection already carried and adds exactly one for that state. The
 * keyless projection remains untouched, so this warning cannot leak into list
 * or batch responses.
 *
 * This function never logs. The cause is classified and handed to
 * `onKeyUnavailable` so the caller emits one degradation event carrying it,
 * rather than the cause being discarded here and the operator left with a
 * misconfigured deployment that looks like a single corrupt row.
 */
export function toCredentialRecordDetail(
  view: LibraryRecordDetailView,
  options: { now?: Date; reveal: DetailRevealer; onKeyUnavailable?: (cause: KeyUnavailableCause) => void },
): CredentialRecordDetailResponse {
  const { base, storageUri, digestMultibase, storedKey } =
    view.origin === LibraryRecordOrigin.NATIVE
      ? {
          base: toNativeCredentialRecord(view, options),
          storageUri: view.credential.storageUri,
          digestMultibase: view.credential.digestMultibase,
          storedKey: view.credential.decryptionKey,
        }
      : {
          base: toCredentialRecord(view, options),
          storageUri: view.external.storageUri,
          digestMultibase: view.external.storageDigestMultibase,
          storedKey: view.external.decryptionKey,
        };

  const warnings: CredentialRecordDetailWarning[] = [...base.warnings];
  let decryptionKey: string | null = null;
  if (storedKey !== null) {
    let cause: KeyUnavailableCause | null = null;
    if (looksEnvelopeLikeButInvalid(storedKey)) {
      // Synthesised rather than caught: the revealer is never called for this
      // branch. It is still one of the reveal path's own error classes, so
      // this reason reaches the operator log with a code like the other two
      // rather than as a bare Error the log can only name by message.
      cause = { reason: 'malformed-envelope', error: new DecryptionKeyEnvelopeMalformedError() };
    } else {
      try {
        decryptionKey = options.reveal(storedKey);
      } catch (error) {
        cause = { reason: classifyRevealFailure(error), error };
      }
    }
    if (cause !== null) {
      warnings.push({
        code: 'DECRYPTION_KEY_UNAVAILABLE',
        message: DECRYPTION_KEY_UNAVAILABLE_MESSAGE,
      });
      options.onKeyUnavailable?.(cause);
    }
  }
  return parseProjection(credentialRecordDetailSchema, view.record.id, {
    ...base,
    storageUri,
    digestMultibase,
    decryptionKey,
    warnings,
  });
}
