# ADR-050: Decrypt collisions merge into the decrypting instance

- **Date:** 2026-08-25
- **Status:** accepted

## Context

In-browser decryption (#813) can reveal that an encrypted envelope's plaintext is a credential the session has already loaded: the decrypted content hash equals an existing instance's hash. [ADR-041](./041-playground-shared-per-instance-artefact-model.md) guarantees one slot per content hash through `upsert`, but a decrypt is the one path where the hash is unknown until after the instance exists, so something must decide which of the two instances survives and what happens to the state pointing at the other. The same reveal creates a second identity question: one plaintext can be represented by many envelopes (each encryption mints a fresh IV), so re-verifying a previously decrypted ciphertext must find its decrypted instance rather than relock a new card.

## Decision

1. **The decrypting instance survives a collision; the twin is absorbed or dropped in one transition.** The instance the user just unlocked keeps its `instanceId`, ordering and source provenance (the encrypted URL or file the user actually brought in), because the URL bindings and link set rows already point at it and the ticket's leading `Decryption` step belongs on the card the user acted on. A twin with a settled pipeline contributes its finished result, adopted behind a prepended successful `Decryption` step so no validation reruns (`admitDecrypted` skips the prepend when the twin already led with one, i.e. was itself decrypted earlier); a still-running twin has no finished work worth preserving and is dropped, and the pipeline runs once on the survivor. The lookup and the merge happen inside a single collection transition against current state, so a stale render can neither pick the wrong twin nor leave two slots sharing a hash even transiently.
2. **Every registry pointing at the removed twin is remapped to the survivor in the same handler.** URL bindings ([ADR-049](./049-url-bindings-answer-which-instance-a-url-produced.md)) and the envelope aliases below both follow the merge; a dangling registry entry fails open into a duplicate card, which is precisely the defect the merge exists to prevent.
3. **A session-level envelope-alias registry maps each decrypted ciphertext (by envelope content hash) to its decrypted instance.** Re-ingesting a known envelope, from any entry point, rebinds to that instance and reports `alreadyDecrypted` instead of creating a second locked card, and the link set row states that honestly rather than prompting for a key or claiming a verification restarted. The registry is a Map (envelope hashes come from untrusted documents), fails open when the instance is gone, and lives beside the URL bindings because the collection's content-hash identity cannot carry it: after decryption the instance's hash is the plaintext hash, and the ciphertext hashes that produced it are exactly the information the collection no longer holds.

## Consequences

- A user who decrypts a credential the session already holds ends with one card, their card, carrying the completed validation and a visible `Decryption` step.
- Completed pipeline work is never discarded by a decrypt; only a still-running twin's partial run is.
- Re-verifying any previously decrypted envelope converges on the decrypted instance for the rest of the session.
- The alias registry is one more piece of session state that resets on reload, consistent with the collection it serves.

## Alternatives Considered

- **The twin survives; the decrypting instance is removed.** Rejected: it discards the decrypting slot's identity (its URL bindings and link rows would need remapping anyway), its provenance, and the leading `Decryption` step the acceptance contract puts on the card the user unlocked, and the just-clicked card visibly vanishes.
- **Both instances remain.** Rejected: two slots sharing a content hash breaks the one-slot-per-hash invariant every hash lookup in the collection relies on (first match wins, the other silently orphans).
- **A single `envelopeHash` field on the decrypted payload instead of a registry.** Rejected: one plaintext can have many envelope aliases (fresh IV per encryption), a payload field remembers only the latest, and a plain re-upload replacing the payload would erase it.

## References

- #813 (the decrypt story), #812 (the ingestion gate and URL bindings this builds on)
- [ADR-041](./041-playground-shared-per-instance-artefact-model.md), [ADR-046](./046-link-set-identity-is-the-resolver-request-url.md), [ADR-049](./049-url-bindings-answer-which-instance-a-url-produced.md)
