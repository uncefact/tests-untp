# ADR-043: A requested publish fails loudly and resolves from the identifier

- **Date:** 2026-08-16
- **Status:** accepted

## Context

Issue #738 is the trigger. A user with a correct registrar, scheme, identifier and organisation set up a proof of concept, asked for publishing, and got back a credential with one warning: "Publishing was requested but the entity has no identity scheme configuration". They spent days auditing configuration that was never the problem. The real cause was a bridge defect, and the message could not say so because that one string covers several unrelated situations.

When a caller sets `publishingOptions.publish: true` on `POST /api/v1/credentials`, the route signs and stores the credential, then takes an identifier value from the payload, finds a master-data record (product, then facility, then organisation) whose **primary** identifier matches that value, and walks that record's relations for the scheme's primary key, the registrar's namespace, and the IDR service instance. What the caller sees when that fails is inconsistent:

- Both "no entity matched" and "the matched entity's scheme is incomplete" produce the same `PUBLISH_SKIPPED` code and the same message.
- A third `PUBLISH_SKIPPED` message, "no primary identifier could be resolved", is unreachable: the resolver sets the identifier whenever it sets the scheme fields.
- A failed reference extraction produces its own `REFS_EXTRACTION_FAILED`.
- A missing or broken IDR service instance is not a warning at all: that resolution sits outside the try/catch and throws, **after** the credential has been signed, stored and inserted, so the caller never receives the id of a credential that now exists.
- A matched entity that vanishes between lookup and insert fails the credential's foreign-key write, again after the credential has been stored.

None of the warnings populate the `remediation` field the warning schema already defines, so a caller gets a code and free text and no stated next step.

The entity is not load-bearing for publishing. The scheme, registrar and IDR instance all hang off `Identifier`; the entity contributes only a description (`description || name`). Entity links themselves are returned by both credential reads and documented as existing so credentials can be queried by entity, though that query API has never been built.

An earlier draft of this decision also covered publishing a credential after issuance. That is deferred: the Identity Resolver is append-only and rejects a duplicate link variant with a conflict, including against historical registrations, so a trustworthy retry needs recorded intent and a reconciliation read that this decision does not attempt. Because there is no republish action in this release, a warning's remediation tells the caller to issue again rather than to publish again, and a publish whose outcome is unknown (the resolver unreachable rather than refusing) says so with its own code instead of inviting a retry the resolver would reject as a duplicate.

## Decision

**1. A requested publish that cannot happen returns the credential and a warning that names the specific unmet prerequisite.** Issuance genuinely succeeded, and the credential is signed, stored and real; failing the request would discard it and deny the caller its id, which is worse than an honest partial outcome. So the status stays 201, and each cause gets its own code with the `remediation` field filled: `PUBLISH_REFERENCE_MISSING`, `PUBLISH_SCHEME_INCOMPLETE`, `PUBLISH_IDENTIFIER_UNKNOWN`, `PUBLISH_IDENTIFIER_AMBIGUOUS`, `PUBLISH_IDR_UNAVAILABLE`, `PUBLISH_TARGET_UNRESOLVED`, `PUBLISH_LINKS_UNBUILDABLE` and `IDR_PUBLISH_UNCONFIRMED`, alongside the existing `REFS_EXTRACTION_FAILED`, `IDR_PUBLISH_FAILED` and `DB_STATUS_UPDATE_FAILED`. A publish whose outcome is unknown (the resolver unreachable, or answering 5xx) is reported as unconfirmed rather than failed, because the call may have committed and the resolver rejects a duplicate. `PUBLISH_SKIPPED` is retired, which is a contract change for any caller matching on it.

**2. Publishing must not destroy the response after the credential exists.** (Issuance itself still has fatal paths before the credential row is written, and unrelated database and tenancy failures stay fatal throughout; the guarantee is about the publishing stage, which runs after the credential is durable.) Because a credential that has been signed and stored is a real resource the caller must be told about, the two paths that currently throw after that point are brought onto the warning path: an unresolvable IDR service instance becomes `PUBLISH_IDR_UNAVAILABLE`, and a vanished matched entity is caught on its own foreign key so the credential is created without the link rather than failing. Unrelated database and tenancy failures stay fatal, and the entity-link failure gets its own advisory code, `ENTITY_LINK_FAILED`, because it is not a publishing outcome.

This amends ADR-042 for this case. ADR-042 rules that a server-selected dependency vanishing follows the sanitised server-failure path; that remains right where the dependency is required, and this decision carves out optional enrichment, where a race must not invalidate work that has already succeeded.

**3. Publishing resolves its target from the identifier, not from a matched entity.** Everything a publish needs hangs off `Identifier`, so gating on entity matching makes an enrichment concern decide whether a credential is discoverable, and produces exactly the misdirection #738 hit. The credential's identifier value is looked up per tenant, and publishing proceeds when exactly one identifier matches. When the value matches more than one scheme, the outcome is `PUBLISH_IDENTIFIER_AMBIGUOUS` naming the colliding schemes rather than a guess, since identifier values are unique only within a scheme; the caller disambiguates with `publishingOptions.identifierSchemeId`.

An earlier draft resolved the scheme from the payload's `idScheme` instead, so no caller would have to supply anything. Implementation showed that does not work yet: builders write `idScheme.id` as a scheme URI (for example `https://id.gs1.org/01/`) when the payload is authored externally, and as this system's scheme id when the payload is built here, so the reference cannot select a scheme record without a mapping rule between the two forms. That rule is a decision in its own right and is not made here. Using the payload hint remains the better long-term answer, and would remove the need for the explicit option.

The residual this leaves is real and is accepted for now: because the assertion is not read, a credential whose payload names scheme A can be published under scheme B when B is the only local scheme holding that value, and the caller's `identifierSchemeId` can likewise select a scheme the payload does not name. Refusing to publish whenever an unmappable assertion is present was considered and rejected: it would block publishing for exactly the externally authored credentials this decision exists to unblock, leaving them no better off than #738. Entity linking and the published description still come from the earlier scheme-blind entity match rather than the identifier the publish selected, so those can disagree with the publish target; that incoherence predates this decision and is not closed by it.

Identifier values are not made unique per tenant. The schema scopes uniqueness to `(schemeId, value, tenantId)` deliberately, and a value may legitimately exist under two schemes (a GTIN and an internal code that coincide).

**4. Entity linking continues as best-effort enrichment and never gates publishing.** The link columns have a documented purpose and are part of the published response schema, so they stay; what changes is that a linking failure is advisory only.

**5. The publish target is chosen without silent fall-through across entity types.** Where the payload yields references of several types, the existing product-then-facility-then-organisation priority stands, and a miss on the chosen type is reported rather than quietly retried against another type: publishing a credential under a different subject than the caller's payload leads with is a surprise no warning would make safe.

**6. The IDR service instance resolves scheme, then registrar, then tenant or system default**, matching `POST /identifiers/{id}/links`. Today the credentials route passes only the scheme-level override, so the same identifier can publish to different resolvers depending on which route was used, which is an inconsistency rather than a decision.

## Consequences

Easier: a caller can act on a failed publish, because the code names the prerequisite and the remediation says what to do; a credential whose identifier exists without a master-data record, or whose identifier is a secondary one, now publishes where it previously could not; and no caller loses a credential id for a credential that exists.

Harder: `PUBLISH_SKIPPED` disappears from responses, so anyone matching it must move to the new codes; publishing behaviour changes for identifiers whose registrar (not scheme) carries the IDR instance; and a caller whose identifier value exists under two schemes must now name the scheme, where previously the entity match picked one silently. Entity-less publishing also needs a description the resolver will accept, since it requires a non-empty value and the entity is no longer there to supply one; the link title fills that role, itself defaulting to the data model's name.

Also in this change, an unrelated caller-visible correction: a stored decryption key that cannot be read no longer echoes the operator's encryption-key diagnostic and the failing row's id to the caller, returning the sanitised 500 that every other unhandled failure returns.

Deferred: publishing a credential after issuance, and reconciling with an append-only resolver that rejects duplicate variants. Tracked separately. Also deferred: reading the payload's scheme assertion, and driving entity linking and the published description from the identifier the publish selected.

## Alternatives considered

**Fail the whole issuance when a requested publish cannot happen.** Rejected: the credential has already been signed and stored by the time publishing is attempted, so a non-2xx would either strand a stored credential whose id the caller never learns, or demand a rollback across an external storage service that the system cannot perform. An opt-in strictness flag remains available later, and would still have to return the credential id.

**Keep one skip code and improve only its message text.** Rejected: free text is not machine-readable, and the failure classes differ in what the caller must do (fix scheme configuration, disambiguate an identifier, fix operator configuration, retry later). A caller cannot branch on prose.

**Require identifier values to be unique per tenant, so a bare value always resolves.** Rejected: the schema's uniqueness scope was chosen deliberately, the migration would break tenants that legitimately reuse a string under two identifier systems, and the resolver's own model treats namespace and key type as part of the identity.

**Resolve the scheme from the payload's `idScheme` so no caller has to supply anything.** Rejected for now, and revisited above under decision 3: the reference is a scheme URI in externally authored payloads and this system's scheme id in ones it built, and mapping between those forms is an undecided rule. Callers therefore name the scheme only in the ambiguous case, via `publishingOptions.identifierSchemeId`.

**Publish under any entity type that resolves, falling through when the first misses.** Rejected: a credential published under a facility because its product reference missed is a silent substitution of subject, and the resulting link would be wrong in a way no warning corrects.

**Drop entity linking entirely, since no query API consumes it.** Rejected: the columns are part of the published credential schema and both read responses, and the master-data documentation states they exist to support entity-scoped credential queries. Removing them is an API deprecation with external consumers unknown, which is a different decision from the one this ADR needs.

## References

- Issue #740, and the field report #738 that motivated it
- Issue #894 (a local write failing after an upstream side effect succeeded; owns `DB_STATUS_UPDATE_FAILED`'s general shape)
- ADR-042 (vanished-reference races), amended by decision 2 for optional enrichment
- ADR-036 (database error translation), unchanged: unrelated database failures stay sanitised and fatal
- RFC 9110 section 15.3.2 (201 Created), on why the created resource must still be reported
