# ADR-059: Conformity score membership and catalogue tier diagnosis

- **Date:** 2026-09-17
- **Status:** accepted
- **Update (2026-09-18):** Renumbered from ADR-058 to ADR-059; the decision and body are unchanged.
- **Update (2026-09-17):** Scheme graph and stored scoring-document reads now use one Prisma repeatable-read snapshot, so reload-on-disagreement handling starts from a coherent read window. Ingest records malformed scoring content as `SCHEMA_INVALID` after the schema check, while the parser's stricter direct-consumer failures remain `PARSE_FAILED`; a scheme contradiction that survives reload returns only the validation advisory, while a profile contradiction returns the reloaded graph's warnings beside it.

## Context

ADR-033 section 3 explicitly excluded score values from conformity claim validation. Story #1068 is triggered by that exclusion and by two related gaps: a scheme reference that names a known profile is reported only as an unknown scheme, and a profile reference that names a known scheme or criterion is reported only as absent from the selected scheme's profiles.

The v0.7.0 Conformity Vocabulary Catalogue publishes scoring frameworks at scheme, profile and criterion levels. A Digital Conformity Credential carries an attestation `profileScore` and performance scores, but a performance score does not identify its source framework. The Reference Implementation must therefore preserve publication evidence without claiming that one score belongs to one framework when the credential shape cannot establish that relationship.

## Decision

1. Score validation is advisory. The credentials route runs it inside the existing conformity-validation boundary, and a score or tier warning never prevents a credential from being issued.
2. `profileScore.code` is compared with the codes in the resolved scheme's `schemeScoringFramework`. An absent framework or an empty score list skips the check.
3. Each assessment performance score is compared with the ordered union of the scheme framework, every framework in the selected profile's `criterionScoringFramework` list, and the `requiredPerformance` scores of criteria that assessment references and that resolve in the selected profile. The scheme and profile framework codes are evidence for every assessment under that profile. A required-performance code is evidence only for an assessment that references its criterion. A code published for another criterion's framework passes when it is in the scheme or profile framework, because the v0.7.0 shape does not bind a performance score to a framework.
4. Membership is exact string membership. Codes are not trimmed or case-folded, and an empty string is valid when published. Rank and definition are parsed and retained but are not compared with a submitted score.
5. Performance score checks run only when a profile resolves, the applicable union is non-empty, and every criterion referenced by that assessment resolves in the profile. An assessment with no criteria is still checked against scheme and profile frameworks. No profile means performance scores are not checked. Missing frameworks, empty lists and an empty union produce no score warning.
6. The validator remains pure. Catalogue reference resolution is supplied by the caller. A known id at the wrong tier produces a dedicated scheme or profile warning, except that a profile id belonging to another scheme remains a profile-not-found warning naming its owning scheme. A match at the expected tier wins over a wrong-tier match.
7. The parser carries the scheme framework, profile framework list and criterion required-performance list in the shared conformity-vocabulary types. Present malformed framework, score and required-performance shapes produce structural parse failures at their JSON pointers. Optional absent fields remain absent.
8. The DCC extractor projects only string score codes and records their source paths beside the claim. Performance scores are compacted per assessment, while each assessment retains its source-aligned position. The credentials route remaps every returned score pointer and drops it if it cannot resolve in the submitted credential.
9. The RI reads scoring evidence from the selected scheme row's stored raw document at lookup time, parsing it with the scheme's source URL and specification version. Frameworks are matched by profile and criterion canonical ids within that document. A missing raw document skips score checks and adds a targeted advisory when the claim carries a score. An unparseable raw document does the same after logging its failure pointers. The graph projection still runs, and shared criterion rows never supply scoring evidence.
10. Reference resolution queries the tenant-visible scheme, profile and criterion rows. System rows shadow tenant rows with the same canonical id within each tier, and shadowed parents are excluded. Cross-tier matches are returned in scheme, profile, criterion order. Tier `expected` lists are alphabetical by canonical id, while score lists retain publication order. A successful scheme reload repeats profile diagnosis against the final graph. Reads that still disagree after the reload produce `conformity-claim.validation-error` rather than a not-found, because the claim may be correct against the catalogue as it now stands. The reload is concurrency correctness against the catalogue's own refresh writer, not a defence. Issuance orchestration belongs in the dedicated issuance module, which emits `conformity-claim.score-checks-unavailable` when requested score evidence is unavailable. No Prisma schema or migration change is required.

The read-time projection is deliberately chosen over persistent scoring columns because the raw document already carries the source-owned scoring meaning and is the only safe scope for shared criteria. The cost was measured as whole-issuance latency rather than as an isolated parse, because that is what an issuer experiences. On a development workstation, a clean v0.7.0 Digital Conformity Credential issuance took 356 to 436 ms against an 868 KB scheme document (50 profiles, 2,000 criteria, one framework per profile and one required-performance code per criterion), and 231 to 320 ms against a three-criterion scheme. A claim carrying no score skips the projection entirely.

## Consequences

The issuer receives actionable score and tier diagnostics at issuance while issuance availability remains unchanged. Warning pointers identify the submitted score or reference id. An expected list of score codes, criterion ids or topic ids preserves publication order with duplicates removed. The expected list on a scheme or profile reference warning, including both `wrong-tier` codes, is alphabetical by canonical id instead. A malformed stored document cannot suppress the existing scheme, profile, criterion or topic checks.

The utils package now exposes additional optional capabilities and warning codes. Consumers with exhaustive `ConformityWarningCode` switches must handle the four new codes. Consumers parsing a present scoring framework, score entry or required-performance entry must handle `ConformitySchemeParseError` for malformed shapes. Score evidence is unavailable when a legacy row has no stored raw document, so the RI reports that limitation instead of inferring scores from shared criterion rows.

## Alternatives Considered

- **JSON columns with a backfill:** rejected because a backfill would have to reconstruct framework scope from old rows and could attach shared criterion scores to the wrong scheme. Read-time parsing preserves the owner document as the source of truth.
- **One JSON column containing all frameworks:** rejected because it would duplicate the source document's nested scope and make profile and criterion matching less explicit without avoiding parse work for a changed document.
- **Callback lookup from the validator:** rejected because it would make a pure validator depend on asynchronous catalogue access and would obscure the evidence used for one validation result.
- **RI-only tier diagnosis:** rejected because tier diagnosis belongs beside the shared validator's not-found rules and must remain reusable by the test suite and other consumers.
- **Warn when a published score list is empty:** rejected because an empty list is no publication evidence. The check skips until at least one code exists.

## References

- [ADR-033: UNTP v0.7 Conformity Vocabulary Catalogue Architecture](033-cvc-architecture.md)
- [ADR-034: Error and Warning Reporting Convention for `@uncefact/untp-utils`](034-utils-error-and-warning-reporting.md)
- [ADR-038: Lenient Criterion-Topic Validation While the v0.7.0 DCC Specification and Schema Diverge](038-lenient-criterion-topic-validation-during-spec-schema-divergence.md)
- [uncefact/tests-untp#1068](https://github.com/uncefact/tests-untp/issues/1068)
- [UNTP v0.7.0 Conformity Vocabulary Catalogue schema](https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json)
- [UNTP v0.7.0 Digital Conformity Credential schema](https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json)
