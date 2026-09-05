import type { VerifyJobReference } from '@/lib/prisma/repositories/external-credential.repository';

/**
 * The guard the payload rule needs (see the schema in verify-generation-job.ts).
 * The reference is exactly the four identifiers. A field with business effect
 * (a verifier selection, a check subset, a skip flag) cannot be added here: an
 * older worker would strip it, parse, settle, and not do what was asked. Such
 * a change is a new queue name. An observability-only field, if one is ever
 * added, is added to `ObservabilityFields` below and nowhere else.
 *
 * Four assertions, because mutual assignability alone lets an OPTIONAL
 * undeclared field through (a type lacking `skip?: boolean` is assignable to
 * one that has it, and back). The key-set assertion pins which fields exist;
 * the core fields must be required; a declared observability field must be
 * optional, because a required one would make every job an older web
 * process wrote unparseable by a newer worker, which is the other direction
 * of the rolling window. They fail at type-check time: ts-jest type-checks
 * this package's suites (a `TS2322` fails the suite) and `next build` runs
 * `tsc` over the same files.
 */
type CoreFields = { tenantId: string; recordId: string; generation: number; checkRunId: string };
/** Observability-only additions go here, and only as optional: an older producer never sends them. */
type ObservabilityFields = Record<never, never>;
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type CoreKey = keyof CoreFields;
type ExpectedPayload = CoreFields & ObservabilityFields;

const payloadIsExactlyTheReference: Exact<VerifyJobReference, ExpectedPayload> = true;
const noExtraKeys: Exact<keyof VerifyJobReference, keyof ExpectedPayload> = true;
const coreFieldsAreRequired: Exact<
  Pick<VerifyJobReference, CoreKey>,
  Required<Pick<VerifyJobReference, CoreKey>>
> = true;
// A declared observability field must accept absence: a required one would
// make every job an older web process wrote unparseable by a newer worker.
const observabilityFieldsAreOptional: Exact<
  Omit<VerifyJobReference, CoreKey>,
  Partial<Omit<VerifyJobReference, CoreKey>>
> = true;

describe('the verify job payload contract', () => {
  it('is exactly the four identifiers plus the declared observability fields', () => {
    expect(payloadIsExactlyTheReference && noExtraKeys && coreFieldsAreRequired && observabilityFieldsAreOptional).toBe(
      true,
    );
  });
});
