/**
 * The caller-facing messages the re-verify path returns, kept out of the
 * route module because Next.js permits a route file to export only its
 * handlers and its route configuration, and refuses the build otherwise.
 *
 * The published OpenAPI examples, the documentation and the suites that pin
 * them read the same constants, so the contract quotes the literal the code
 * produces rather than a copy of it. A message that reaches a caller through
 * more than one module (the route's synchronous refusal and the worker's
 * settlement of the same has-a-copy case, for instance) is one constant here
 * rather than two literals that have to be kept equal by hand.
 *
 * This module imports nothing, so every module that publishes or settles one
 * of these can read it without a cycle.
 *
 * The module holds the sentences and the small custody predicates that pick
 * between them ({@link recoveryResumeGuidance}) or decide the refusal one of
 * them states ({@link cannotAcceptSupplierKey}), but not every caller of
 * those rules: the
 * reconciliation sweep's own selection runs in
 * `check-run.repository.ts`'s `settleAbandonedCheckRun`, because the custody
 * it decides from is read inside the sweep's own query. Anyone changing this
 * guidance has one more site to look at than this file.
 */

/**
 * A record holding a durable copy of unopened ciphertext, asked to re-verify
 * with no key. Raised synchronously by the route's `DecryptionRequiredError`
 * before any fetch, and settled by the worker when it reaches the same copy
 * with no stored key. Both describe the same record in the same terms, so
 * they read the same constant rather than two copies of one sentence.
 */
export const DECRYPTION_REQUIRED_MESSAGE =
  "This service holds no usable key for the record's durable copy. Supply it as sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.";

/**
 * A supplied key that no branch can apply. Covers both triggers: a native
 * record, whose copy this service issued and already holds the key for, and
 * an external record whose durable copy is already receiver-protected. The
 * wording states the one condition under which a key IS accepted, so it is
 * true of both.
 */
export const SOURCE_ENCRYPTION_NOT_ALLOWED_MESSAGE =
  'sourceEncryption may only be supplied for an external record with no protected durable copy yet.';

/**
 * What a site observed about the receiver key this service holds for a
 * record. `storageUri` is the durable copy that key opens; a site that did
 * not read it passes `undefined`, which is not the same as reading `null`.
 */
export type KeyAcceptanceObservation = {
  /** Whether this service holds a receiver key of its own for the record. */
  decryptionKeyPresent: boolean;
  /** The durable copy that key opens, or `undefined` where the site did not read it. */
  storageUri?: string | null;
};

/**
 * Whether a supplied supplier key can never be applied to this external
 * record, so the request is refused {@link SOURCE_ENCRYPTION_NOT_ALLOWED_MESSAGE}
 * rather than reserving a generation for a key nothing could use.
 *
 * Three sites decide this and each observes the record differently: the
 * route's pre-lock read (`reverify-library-record.ts`) has the key envelope,
 * the reservation's own lock (`check-run.repository.ts`) has a full custody
 * snapshot, and the race resolver in the same file has a key-presence
 * projection and no copy. They read this one function so the condition is
 * written once, and it is safe for a site that never read the copy because a
 * held key always comes with one: `external-credential.repository.ts` is the
 * only writer of `decryptionKey` on `ExternalCredential`, and it writes
 * `storageUri` and `decryptionKey` from the same required `storage` object in
 * a single `data` block, so key-present-with-no-copy is unwritable. A second
 * writer of that column has to revisit this, because the three sites would
 * then be able to disagree.
 */
export function cannotAcceptSupplierKey(observed: KeyAcceptanceObservation): boolean {
  if (!observed.decryptionKeyPresent) return false;
  // `undefined` means this site did not read the copy and leans on the
  // invariant above; `null` means it read the row and there is none.
  return observed.storageUri === undefined || observed.storageUri !== null;
}

/** A key-bearing request that met a pending generation, which cannot consume its key. */
export const VERIFICATION_IN_PROGRESS_MESSAGE =
  'Verification is already in progress for this record. Wait for it to settle before supplying a key again.';

/**
 * A key-bearing request that lost the generation-index race twice, and whose
 * winner had already settled by the time the winner was read. Nothing is in
 * progress at that moment, so telling the caller to wait for a settlement
 * that already happened would send them to poll for nothing. What they need
 * to know is that their key was never consumed, so it can go again straight
 * away. The status stays `409`: the request could not be carried out as
 * sent, and the remedy is to send it again.
 */
export const VERIFICATION_RACE_LOST_MESSAGE =
  'Another verification generation was recorded for this record first, so the supplied key was not used. Send it again on POST /api/v1/library/{id}/verify.';

/**
 * The reconciliation sweep's message for a generation abandoned before it was
 * finalised, on a record a plain re-verify can take forward on its own.
 */
export const ABANDONED_RUN_MESSAGE =
  'The verification job did not report a result within the expected window. Re-verify to run it again.';

/**
 * The same abandonment, on an external record still holding an unopened
 * encrypted copy. A bodyless re-verify of that record is refused
 * {@link DECRYPTION_REQUIRED_MESSAGE}, so telling the caller to "re-verify"
 * would name an action that cannot succeed: the key has to be sent again.
 */
export const ABANDONED_UNOPENED_COPY_MESSAGE =
  'The verification job did not report a result within the expected window. This record still holds an unopened encrypted copy, so resend the key as sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.';

/**
 * The same abandonment again, settled when the record's own custody could not
 * be read, so which of the two messages above applies is unknown. Naming
 * both moves is the honest projection of not knowing: guessing "re-verify"
 * misdirects the unopened-copy record this feature exists for, and guessing
 * "resend the key" misdirects every native and receiver-protected record.
 */
export const ABANDONED_CUSTODY_UNKNOWN_MESSAGE =
  'The verification job did not report a result within the expected window, and this record could not be read to say how to resume it. Re-verify to run it again; if the record still holds an unopened encrypted copy, resend the key as sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.';

/**
 * A stored copy that could not be read back at all. The reader's own reason
 * is carried through, exactly as the worker carries it, so an operator can
 * tell a 404 from a timeout from the read cap instead of reading one sentence
 * that fits every cause.
 *
 * The next step splits on the same classification that decides `retryable`.
 * One sentence for both gets both wrong: a caller whose storage was briefly
 * unreachable is told to inspect an object they cannot reach, and one whose
 * object is gone for good is told to keep retrying.
 *
 * The retryable half takes its move from {@link recoveryResumeGuidance}
 * rather than saying "re-verify" on its own. This message is only ever
 * settled on a stored-copy acquisition, and the custody that chooses that
 * acquisition is usually a copy of unopened ciphertext, for which a plain
 * re-verify is refused `400 DECRYPTION_REQUIRED` before any fetch: telling
 * that caller to re-verify once storage is reachable names an action the
 * route will not carry out. A record whose copy this service can already
 * open still gets the plain re-verify.
 */
export function storedCopyReadFailedMessage(
  readerReason: string,
  classification: 'transient' | 'terminal',
  custody: ResumeGuidanceCustody,
): string {
  return classification === 'transient'
    ? `The durable copy could not be read back from storage (${readerReason}); the read may succeed on a later attempt. ${recoveryResumeGuidance(
        custody,
      )}`
    : `The durable copy could not be read back from storage (${readerReason}); this needs an operator to inspect the stored object.`;
}

/**
 * A supplied key that did not open the record's own durable copy. The copy is
 * untouched by the attempt, so the caller's move is another key rather than
 * anything about the supplier.
 *
 * Here rather than beside the failure that returns it because the published
 * `lateKeyDidNotOpenTheCopy` example in the verify route's Swagger docblock
 * shows this exact sentence, and a docblock cannot import. The contract test
 * compares the example against this constant, so the document quotes the
 * literal the code produces instead of a copy that drifts from it.
 */
export const STORED_COPY_KEY_MISMATCH_MESSAGE =
  "The supplied decryption key did not open this record's durable copy. The copy is kept exactly as it is. Retry with the correct sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.";

/**
 * A copy that WAS read back and cannot be proven intact, because no integrity
 * digest was recorded for it. The generation keeps the `retrieval: pass` it
 * earned, so a message saying the copy could not be read would contradict the
 * checks stored beside it.
 */
export const STORED_COPY_NO_DIGEST_MESSAGE =
  'The durable copy was read back, but this record holds no integrity digest for it, so the copy cannot be proven intact before it is opened; this needs an operator to inspect the record.';

/** The same state, with a recorded digest that could not be read. */
export const STORED_COPY_DIGEST_UNREADABLE_MESSAGE =
  'The durable copy was read back, but the integrity digest recorded for it could not be read, so the copy cannot be proven intact before it is opened; this needs an operator to inspect the record.';

/**
 * A copy that came back and did not match its recorded digest, so it was
 * never opened. Not retryable, which means the caller has no move of their
 * own through the API, so the sentence names who can act, as its two siblings
 * above do.
 */
export const STORED_COPY_DIGEST_MISMATCH_MESSAGE =
  'The retained durable copy failed its integrity digest check, so it was not opened; this needs an operator to inspect the stored object.';

/**
 * What became of the record when the storage encryption preflight refused a
 * recovery that had already opened the credential, and who has to act.
 *
 * The cause's own sentence ("Credential storage encryption is not
 * available.") was written for an immediate `500` on the register path, where
 * the caller reads it in the same breath as their request. Here it lands on a
 * settled generation read later by a caller polling the detail route, so the
 * settlement adds this, and then the custody-selected next step.
 */
export const ENCRYPTION_UNAVAILABLE_RECOVERY_DETAIL =
  'The credential was opened but not stored, so this record is unchanged. Wait for an operator to restore storage encryption.';

/**
 * The custody coordinates that decide what a caller should do next. Named
 * structurally rather than by importing the repository's snapshot type, so
 * this module keeps importing nothing and every layer can read it without a
 * cycle. Both callers pass a snapshot that satisfies it.
 */
export type ResumeGuidanceCustody = {
  storageUri: string | null;
  decryptionKeyPresent: boolean;
  encrypted: boolean | null;
};

/**
 * Whether a record still holds a durable copy of ciphertext this service has
 * no key for. That is the one custody shape a plain re-verify cannot take
 * forward, because it is refused {@link DECRYPTION_REQUIRED_MESSAGE} before
 * any fetch. A native copy's key is this service's own and a receiver-
 * protected external copy's key is already held, so neither is unopened.
 */
export function holdsUnopenedCopy(custody: ResumeGuidanceCustody): boolean {
  return custody.storageUri !== null && !custody.decryptionKeyPresent && custody.encrypted === true;
}

/** The re-verify half of the guidance, for a record a bodyless request can take forward. */
export const RESUME_BY_REVERIFYING = 'Re-verify to try again.';

/** The resend half, for a record still holding an unopened encrypted copy. */
export const RESUME_BY_RESENDING_KEY =
  'This record still holds an unopened encrypted copy, so resend the key as sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.';

/**
 * The next step to give a caller whose recovery settled without reaching a
 * result, chosen from the custody the settlement observed. Every settled
 * recovery failure that ends "try again" reads this rather than stating a
 * move of its own: the four request-path failures (a queue that would not
 * start after the reservation, a twice-collided content identity, an
 * unexpected throw, and an exhausted lock discovery) all became reachable
 * from a record holding an unopened copy, for which "re-verify" names an
 * action the route refuses `400 DECRYPTION_REQUIRED`.
 */
export function recoveryResumeGuidance(custody: ResumeGuidanceCustody): string {
  return holdsUnopenedCopy(custody) ? RESUME_BY_RESENDING_KEY : RESUME_BY_REVERIFYING;
}
