The untp-test-suite package aims to be a re-usable library for testing United Nations Transparancy Protocol (UNTP) credentials. The library should include a CLI to test UNTP credentials but also be easy to use from other UX's such as a web interface.

Specifically, the package should enable the following tiers of tests:

- Tier 1 validation: Ensures each credential file is a valid VerifiableCredential (that is, it is valid JSON, valid JSON Linked Data, and conforms to the W3C Verifiable Credential schema).
- Tier 2 Validation: Determines the UNTP credential type and validates credentials against the UNTP-specific schemas, including required fields.
- Tier 3 Validation: Creates a graph from the provided credentials and runs inferences on the data, before querying the resulting data to check issuer trust-chains as well as product claim conformance.

This will enable UNTP implementors to verify the validity of credentials that they produce and consume, both in CI development environments and production situations, while also supporting web UXs such as the sibling [UNTP Playground](../../untp-playground) package (which currently re-implements the same tests rather than re-using the untp-test-suite package).

Currently tiers 1 and 2 are present here, while tier 3 is yet to be added (though it has been verified in a [proof-of-concept graph validation cli](https://github.com/absoludity/untp-graph-validation-cli) ).

See the [current product context](./02-product-context.md).
