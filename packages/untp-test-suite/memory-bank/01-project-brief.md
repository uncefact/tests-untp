# UNTP Test Suite Mocha - Project Brief

The untp-test-suite-mocha package should be a re-usable library for testing United Nations Transparency Protocol (UNTP) credentials and extensions of those credentials. The library should include a CLI to test UNTP credentials but also be easy to call and use from other UX's such as a web interface.

## Testing Tiers

The package should enable running the following tiers of tests:

- **Tier 1 validation**: Ensures each credential file is a valid VerifiableCredential (that is, it is valid JSON, valid JSON Linked Data, and conforms to the W3C Verifiable Credential schema).
- **Tier 2 Validation**: Determines the UNTP credential type and validates credentials against the UNTP-specific schemas, including required fields.
- **Tier 3 Validation**: Creates a graph from the provided credentials and runs inferences on the data, before querying the resulting data to check issuer trust-chains as well as product claim conformance.

## Technical Architecture

### TypeScript by Default

The main package should be written in TypeScript by default, providing type safety and better developer experience for both the library itself and for consumers of the library.

### Universal Test Runner

The library uses Mocha as the test runner, which can run in both Node.js (CLI) and browser environments, allowing the same tests to be executed in different contexts with identical behavior.

### Streaming Test Results

The library provides real-time streaming test results through a custom StreamReporter that works identically in both CLI and browser environments. Test results are streamed as they happen rather than batched at completion.

### Tag-Based Test Filtering

Tests use a simple `tag:tagname` format in test titles for precise filtering. The CLI supports `--tag` options using Mocha's built-in grep functionality with word boundaries for exact tag matching.

### Extension Testing Support

The library should support extension testing by allowing users to specify additional directories containing Mocha tests for each tier. The extension test directory structure should follow the same tier organization as the core tests:

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

### Browser File Upload Support

In browser environments, the library supports file upload functionality where users can upload credential files for testing against the built-in UNTP test suites. The same UNTPMochaRunner API works with uploaded credential content, enabling dynamic testing of user-provided credentials.

## Goals

This will enable UNTP implementors to verify the validity of credentials that they produce and consume, both in CI development environments and production situations, while also supporting web UXs such as the sibling [UNTP Playground](../../untp-playground) package. The universal compatibility allows the same validation logic to be shared between CLI tools and web applications, with support for real-time streaming results and flexible tag-based test filtering.

See the [current product context](./02-product-context.md).
