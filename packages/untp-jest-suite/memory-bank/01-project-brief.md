# UNTP Jest Suite - Project Brief

The untp-jest-suite package should be a re-usable library for testing United Nations Transparency Protocol (UNTP) credentials and extensions of those credentials. The library should include a CLI to test UNTP credentials but also be easy to call and use from other UX's such as a web interface.

## Testing Tiers

The package should enable running the following tiers of tests:

- **Tier 1 validation**: Ensures each credential file is a valid VerifiableCredential (that is, it is valid JSON, valid JSON Linked Data, and conforms to the W3C Verifiable Credential schema).
- **Tier 2 Validation**: Determines the UNTP credential type and validates credentials against the UNTP-specific schemas, including required fields.
- **Tier 3 Validation**: Creates a graph from the provided credentials and runs inferences on the data, before querying the resulting data to check issuer trust-chains as well as product claim conformance.

## Technical Architecture

### TypeScript by Default
The main package should be written in TypeScript by default, providing type safety and better developer experience for both the library itself and for consumers of the library.

### Extension Testing Support
The library should support extension testing by allowing users to specify additional directories containing Jest tests for each tier. The extension test directory structure should follow the same tier organization as the core tests:

```
# Core tests (built into the package)
tests/
├── tier1/           # Core Tier 1 tests
├── tier2/           # Core Tier 2 tests
└── tier3/           # Core Tier 3 tests

# Extension tests (user-provided directory)
/path/to/user/extensions/
├── tier1/           # Extension Tier 1 tests
├── tier2/           # Extension Tier 2 tests
└── tier3/           # Extension Tier 3 tests
```

### Schema Management
For UNTP credentials, schema management should be handled automatically based on the credential type and context version found in the credential itself. Extension support (with input mapping of type and version to schema) will be addressed in future iterations.

## Goals

This will enable UNTP implementors to verify the validity of credentials that they produce and consume, both in CI development environments and production situations, while also supporting web UXs such as the sibling [UNTP Playground](../../untp-playground) package (which currently re-implements the same tests rather than re-using a package that can also be used from the CLI).

See the [current product context](./02-product-context.md).