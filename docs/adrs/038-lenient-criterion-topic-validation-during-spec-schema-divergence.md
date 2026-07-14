# ADR-038: Lenient Criterion-Topic Validation While the v0.7.0 DCC Specification and Schema Diverge

- **Date:** 2026-07-08
- **Status:** accepted

## Context

The UNTP v0.7.0 Digital Conformity Credential artefacts disagree about where conformity topics live. The [specification text](https://untp.unece.org/docs/specification/ConformityCredential) states that each criterion in `conformityAssessment[].assessmentCriteria` "MUST be classified by a conformityTopic drawn from the UNTP Conformity Topics taxonomy", and both the specification page's inline example and the [published sample instance](https://untp.unece.org/artefacts/samples/v0.7.0/dcc/ConformityCredential_instance.json) carry `conformityTopic` arrays on each criterion. The [published JSON Schema](https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json), however, declares no `conformityTopic` property on the `assessmentCriteria` items (only `type`, `id`, `name`); it declares the field on the assessment itself. The divergence has been reported upstream to the UNTP specification project (https://opensource.unicc.org/un/unece/uncefact/spec-untp/-/issues/741).

The consequence for CVC advisory validation (ADR-033 §3) is that credentials authored strictly to the published schema carry no criterion-level topics, through no fault of the issuer. The claim extractor and validator must decide how to treat an unclassified criterion: as a spec deviation to warn about, or as an artefact of the schema omission to pass over.

## Decision

While the divergence stands, an unclassified criterion is treated leniently. The v0.7.0 claim extractor leaves `conformityTopics` absent (rather than empty) on a criterion whose credential entry declares no topics, and the validator's existing contract passes over an absent topic list, because an absent list marks a data model that does not classify the criterion whereas an empty list is an explicit declaration that runs the check. Declared assessment-level topics still get validated for such credentials: the schema-required `conformityAssessment[].conformityTopic` declarations are checked against the deduplicated union of the published topics of the assessment's criteria (the `conformity-assessment.topic-mismatch` warning recorded in the ADR-033 update of 2026-07-08). An assessment that declares an empty topic array leaves the topic lane unchecked for that assessment, an accepted cost until upstream clarifies the field's cardinality.

The lenient treatment is deliberately temporary. When the upstream artefacts are reconciled, the strict reading (an unclassified criterion on a v0.7.0 claim warrants an advisory warning, because the specification marks classification a MUST) becomes the intended behaviour, and this ADR should be superseded by the decision that introduces it. The tightening work is tracked as a follow-up issue referencing this ADR and the upstream report.

## Consequences

- Credentials authored to the published JSON Schema validate without manufactured warnings, so issuers following the only machine-enforceable artefact are not penalised for the artefacts' disagreement.
- Credentials authored to the specification text (criterion-level topics present) get the full per-criterion topic validation, both directions, unchanged.
- A v0.7.0 credential that genuinely forgets to classify a criterion is not flagged while this ADR is in force; the assessment-level check catches topic taxonomy errors but not the omission itself. This is the accepted cost of leniency.
- The tightening depends on an external party's timeline. Until upstream resolves, this ADR is the record of why the validator is more permissive than the specification text.

## Alternatives Considered

- **Extract an empty topic list for unclassified criteria.** The validator's empty-list contract runs the omission check, so every schema-authored credential would receive "criterion defines a topic the claim does not declare" warnings for every criterion. Rejected because it penalises issuers for following the published schema, and an advisory channel that reliably warns on conformant input trains issuers to ignore it.
- **Inherit the assessment's topics onto unclassified criteria in the extractor.** Rejected because it manufactures per-criterion assertions the credential never made; an assessment may bundle criteria spanning different topics, so inherited topics produce false per-criterion mismatches (the published sample instance itself would warn), and validation should test the issuer's declarations, not the extractor's inferences.
- **Adopt the strict reading immediately.** Warning on every unclassified criterion is faithful to the specification text, but the published schema is the artefact issuers can actually validate against, and the divergence is upstream's defect to resolve. Rejected for now; recorded as the intended end state above.

## References

- ADR-033 (CVC architecture; §3 advisory validation and warning codes, including the 2026-07-08 update this ADR accompanies)
- #748 (the extraction defect that surfaced the divergence)
- #751 (the tightening follow-up this ADR's Decision section commits to)
- Upstream report: https://opensource.unicc.org/un/unece/uncefact/spec-untp/-/issues/741
- Upstream related discussion: https://opensource.unicc.org/un/unece/uncefact/spec-untp/-/issues/618 (parent-level versus criterion-level placement for the Claim class)
- https://untp.unece.org/docs/specification/ConformityCredential
- https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json
- https://untp.unece.org/artefacts/samples/v0.7.0/dcc/ConformityCredential_instance.json
