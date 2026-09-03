import { z } from 'zod';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
  type CheckRun,
} from '@/lib/prisma/generated';
import { CHECK_NAMES, type CheckName } from '@/lib/prisma/repositories/check-run.repository';
import type { ExternalCredentialRecord } from '@/lib/prisma/repositories/external-credential.repository';

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

export const verificationChecksSchema = z
  .object({
    retrieval: checkResultSchema,
    decryption: checkResultSchema,
    digest: checkResultSchema,
    proof: checkResultSchema,
    status: checkResultSchema,
    temporal: checkResultSchema.describe('Recorded as evidence; never part of the blocking set.'),
    schemaConformance: checkResultSchema.describe('Advisory only; never blocks a verified summary.'),
  })
  .strict()
  .describe('All seven checks are always present; `not_run` covers both "did not apply" and "did not execute".');

export type VerificationChecks = z.infer<typeof verificationChecksSchema>;

/**
 * The checks whose failure makes a complete generation `not_conformant`.
 * `temporal` is evidence only (currency is reported on the record) and
 * `schemaConformance` is advisory, so neither is here.
 */
export const BLOCKING_CHECKS = [
  'retrieval',
  'decryption',
  'digest',
  'proof',
  'status',
] as const satisfies readonly CheckName[];

/**
 * The contract's derivation rule for a complete generation: any blocking
 * `fail` is `not_conformant`; otherwise every blocking check that ran passed,
 * which is `verified` only when at least one of them actually ran. An
 * all-`not_run` blocking set can never read as verified.
 */
export function deriveCompleteSummary(checks: VerificationChecks): 'verified' | 'not_conformant' {
  const blocking = BLOCKING_CHECKS.map((name) => checks[name]);
  if (blocking.includes('fail')) return 'not_conformant';
  if (blocking.every((result) => result === 'not_run')) return 'not_conformant';
  return 'verified';
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

const completeEnvelopeSchema = z
  .object({
    ...envelopeBase,
    state: z.literal('complete'),
    completedAt: z.string().datetime(),
    summary: z.enum(['verified', 'not_conformant']),
  })
  .strict();

const failedEnvelopeSchema = z
  .object({
    ...envelopeBase,
    state: z.literal('failed'),
    completedAt: z.string().datetime(),
    summary: z.literal('failed'),
    failure: z
      .object({
        code: failureCodeSchema,
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

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
        message: 'summary must be derived from the blocking checks',
      });
    }
  })
  .describe(
    'Discriminated by `state`. A `pending` envelope has neither `completedAt` nor `failure`; `complete` has `completedAt` and no `failure`; `failed` has both. A `complete` summary is derived from the blocking checks (retrieval, decryption, digest, proof, status): any `fail` is `not_conformant`, otherwise `verified` when at least one of them ran. `temporal` and `schemaConformance` never change it.',
  );

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

export const credentialRecordSchema = z
  .object({
    id: z.string().describe('Opaque; never parse or derive meaning from it.'),
    origin: z.enum(['native', 'external']),
    credential: z
      .object({
        name: nullableString,
        credentialType: z.nativeEnum(CoreCredentialType).nullable(),
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
        declaredCredentialType: z.nativeEnum(CoreCredentialType),
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
    verification: verificationEnvelopeSchema,
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

/** A record read from the database whose rows cannot be projected: a broken invariant, never caller input. */
export class CredentialRecordProjectionError extends Error {
  constructor(recordId: string, detail: string) {
    super(`Library record ${recordId} cannot be projected: ${detail}`);
    this.name = 'CredentialRecordProjectionError';
  }
}

const WIRE_RESULT: Record<CheckResult, VerificationChecks[CheckName]> = {
  [CheckResult.PASS]: 'pass',
  [CheckResult.FAIL]: 'fail',
  [CheckResult.NOT_RUN]: 'not_run',
};

function wireChecks(run: CheckRun): VerificationChecks {
  return Object.fromEntries(CHECK_NAMES.map((name) => [name, WIRE_RESULT[run[name]]])) as VerificationChecks;
}

function envelopeOf(run: CheckRun): VerificationEnvelope {
  const base = { generation: run.generation, requestedAt: run.requestedAt.toISOString(), checks: wireChecks(run) };
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
      return { ...base, state: 'complete', completedAt: completedAt(), summary: deriveCompleteSummary(base.checks) };
    case CheckRunState.FAILED: {
      if (run.failureCode === null || run.failureMessage === null || run.failureRetryable === null) {
        throw new CredentialRecordProjectionError(
          run.recordId,
          `check run ${run.id} is FAILED with no failure recorded`,
        );
      }
      return {
        ...base,
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
  const warnings: CredentialRecordWarning[] = [];
  if (external.decryptionKeyUnused) {
    warnings.push({
      code: 'DECRYPTION_KEY_UNUSED',
      message: 'A decryption key was supplied but the source was plaintext, so the key was not used.',
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
    verification: envelopeOf(checkRun),
    currencyStatus: deriveCurrencyStatus(parent.validFrom, parent.validUntil, now),
    detailsStatus: parent.detailsStatus,
    detailsError: parent.detailsError,
    capabilities: { deletable: true, annotatable: true, verifiable: true },
    warnings,
    createdAt: parent.createdAt.toISOString(),
    updatedAt: parent.updatedAt.toISOString(),
  };
  const checked = credentialRecordSchema.safeParse(projected);
  if (!checked.success) {
    throw new CredentialRecordProjectionError(parent.id, checked.error.issues.map((issue) => issue.message).join('; '));
  }
  return checked.data;
}
