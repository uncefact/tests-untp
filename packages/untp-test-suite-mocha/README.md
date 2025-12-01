# UNTP Test Suite

A reusable testing library for United Nations Transparency Protocol (UNTP) credentials that works in both Node.js CLI and browser environments, using [Mocha](https://mochajs.org/).

Importantly, the same test runner is used in both environments for running the tests.

## Example CLI Usage

![CLI Usage](doc/images/console-tag-schema.png)

## Example Browser Usage

![Browser Usage](doc/images/browser-tag-schema.png)

## Example tier 2 test

Since the test runner is using mocha and chai, we benefit from simple test language.
Below is an example showing the main tier 2 test which gets the schema for a UNTP
credential type and expects the credential to match that schema:

```typescript
it(`should validate against ${untpType} UNTP schema tag:schema`, async () => {
  // Get the appropriate UNTP schema URL for this credential type
  const schemaUrl = await untpTestSuite.getSchemaUrlForCredential(parsedCredential, untpType);

  // Assert that we can determine a UNTP schema URL for this credential
  expect(schemaUrl, 'Should be able to determine UNTP schema URL for credential').to.be.a('string');

  // Validate the credential against its specific UNTP schema
  await expect(parsedCredential).to.match.schema(schemaUrl);
});
```

## Features

- **Both CLI and Browser Compatibility** - Same tests run in CLI and browser
- **Real-time Streaming Results** - Live test output with custom reporter
- **Tag-based Filtering** - Specific sets of tests can be selected using tags
- **Extension Schema Mapping** - Support for custom credential types with configurable mapping of extension type to schemas (both in CLI and browser)
- **General test extensibility** - TBD

## Testing Tiers

The package enables running the two tiers of UNTP validation that are currently available:

- **Tier 1**: W3C Verifiable Credential validation (JSON, JSON-LD, schema conformance)
- **Tier 2**: UNTP-specific credential type validation and required fields
- **Tier 3**: Graph inference, trust-chain verification, and claim conformance

## Installation

This package is part of the `tests-untp` monorepo and is not currently published to npm. To use it, you need to install dependencies from the repository root and build the package locally.

### Prerequisites

Follow the [Prerequisites section](../../README.md#prerequisites) in the root README to set up Node.js and Yarn.

### Setup Steps

1. **Install dependencies from the repository root** (this ensures packages are hoisted correctly):

   ```bash
   # From the repository root directory
   yarn install
   ```

2. **Build the package**:
   ```bash
   # From the packages/untp-test-suite-mocha directory
   cd packages/untp-test-suite-mocha
   yarn build
   ```

After building, you can use the CLI commands with `npx` to pick up the local build.

## CLI Usage

### Basic Usage

Test credential files directly or by passing a directory:

> **Note**: In the examples below, `credential.json`, `credential1.json`, etc. are placeholder filenames that don't exist - replace them with paths to your actual credential files. Examples using `./example-credentials/` reference actual example files included in this package.

```bash
# Test single credential file (replace credential.json with your credential file)
npx untp-test credential.json

# Test multiple files (replace with your credential files)
npx untp-test credential1.json credential2.json credential3.json

# Test all credential files from directory (example-credentials/ exists)
npx untp-test --directory ./example-credentials/UNTP/

# Combine individual files with directory scanning (replace credential.json with your credential file)
npx untp-test credential.json --directory ./example-credentials/UNTP/

# With tag filtering
npx untp-test --directory ./example-credentials/UNTP/ --tag tier1

# Trust root issuer
npx untp-test --directory ./example-credentials/UNTP/ --trust-did=did:web:abr.business.gov.au
```

**Supported file types**: `.json` and `.jsonld` files are automatically detected and included when scanning a directory.

### Extension Schema Mapping

Test credentials with custom extension types by providing schema mapping files:

```bash
# Test extension credential with custom schema mapping
npx untp-test --extension-schema-map example-credentials/extensions/digital-livestock-mapping.json \
example-credentials/extensions/DigitalLivestockPassport/digital-livestock-passport-simple-working-context.json

# Multiple extension mappings (replace credential.json with your credential file)
npx untp-test --extension-schema-map ./ext1.json --extension-schema-map ./ext2.json credential.json

# Combine with directory scanning
npx untp-test --extension-schema-map example-credentials/extensions/digital-livestock-mapping.json \
--directory ./example-credentials/extensions/DigitalLivestockPassport
```

Extension mapping files define how to resolve schema URLs for custom credential types:

```json
{
  "version": "0.1.0",
  "mappings": [
    {
      "credentialType": "DigitalLivestockPassport",
      "schemaUrlPattern": "https://jargon.sh/user/aatp/DigitalLivestockPassport/v/working/artefacts/jsonSchemas/DigitalLivestockPassport.json?class=DigitalLivestockPassport"
    }
  ]
}
```

See [default-mappings.json](src/untp-test/schema-mapper/default-mappings.json) for an example showing the schema mapping used for UNTP credentials, or [digital-livestock-mapping.json](example-credentials/extensions/digital-livestock-mapping.json) for an example showing the mapping used for an example extension.

### Tag Filtering

Run only specific test types using tags:

```bash
# Run only Tier 1 tests (replace credential.json with your credential file)
npx untp-test --tag tier1 credential.json

# Run only basic validation tests on directory
npx untp-test --tag basic --directory ./credentials

# Combine multiple tags
npx untp-test --tag tier1 --tag smoke --directory ./credentials

# Run validation and JSON-LD tests (replace credential.json with your credential file)
npx untp-test --tag validation --tag jsonld credential.json
```

### Trust issuer for tier 3 tests

Use `--trust-did` option to add a trusted issuer's _Decentralized Identifier_. Current example files in `example-credentials/` directory has all credentials in a single trust graph, with a sigle root of trust - `did:web:abr.business.gov.au`. Adding trusted root issuer in this way will trust all the underlying issuers in the _DIA_ chain, accepting issued _DPP_ and _DCC_ within this trust graph.

This option can be used multiple times.

```bash
npx untp-test --directory ./example-credentials/UNTP/ --trust-did=did:web:abr.business.gov.au
```

### Example Output

```
Testing 1 credential files

Running UNTP validation tests...

Tier 1 - W3C Verifiable Credential Validation  (tags: tier1, w3c)
    ✔ should have access to credential state  (tags: basic, integration)
  product-passport-simple.json
      ✔ should be a valid JSON-LD document  (tags: jsonld) (596ms)
      ✔ should match the VerifiableCredential 1.1 schema  (tags: schema) (126ms)
Tier 2 - UNTP Schema Validation  (tags: tier2, untp)
    ✔ should have access to credential state  (tags: basic, integration)
  product-passport-simple.json
      ✔ should validate against DigitalProductPassport UNTP schema  (tags: schema) (105ms)
Tier 3 - UNTP RDF Validation  (tags: tier3, untp)
    ✔ should have access to credential state  (tags: basic, integration) (1ms)
    ✔ conformity-credential-simple.json should be a valid RDF document.  (tags: rdf) (1169ms)
    ✔ identity-anchor-for-dcc-issuer.json should be a valid RDF document.  (tags: rdf) (831ms)
    ✔ identity-anchor-for-dia-issuer.json should be a valid RDF document.  (tags: rdf) (857ms)
    ✔ identity-anchor-for-dpp-issuer.json should be a valid RDF document.  (tags: rdf) (810ms)
    ✔ product-passport-simple.json should be a valid RDF document.  (tags: rdf) (889ms)
Running 3 inference rules...
Executing inference rule: 10-infer-product-claim-criteria-verified.n3
Executing inference rule: 20-infer-product-claim-verified.n3
Executing inference rule: 30-infer-identity-verified.n3
Inference succeded: true. Total RDF quads in graph: 132
  Verifications
      ✖ should verify all product claims and issuer trust chains
        Product "EV battery 300Ah", Claim "conformityTopicCode#environment.emissions", Criterion "GBA Battery rule book v2.0 battery assembly guidelines": should be verified in Digital Conformity Credential: expected undefined not to be undefined

  5 passing (835ms)
  1 failing

error Command failed with exit code 1.
```

## Example Browser Usage

A small example browser test page has been generated that shows how you can run
the same tests with the same test runner, in a browser environment.

### Quick Start

1. Build the browser bundle (from the `packages/untp-test-suite-mocha` directory):

```bash
cd packages/untp-test-suite-mocha
yarn build:browser
yarn browser-test
```

2. Open `http://localhost:8080` in your browser

3. Upload credential files (.json or .jsonld) using drag & drop or file selection

4. Optionally upload extension schema mapping JSON files for custom credential types

5. Optionally add tags for filtering (e.g., `tier1`, `validation`, `smoke`)

6. Optionally add trusted issuer DID (e.g., `did:web:abr.business.gov.au`)

7. Click "🚀 Run Tests" to see real-time results

Note that re-running tests uses the browser's cache automatically and so schemas are not re-fetched (and there's a [task](memory-bank/tasks/TASK006-persistent-http-cache.md) to
get the same behaviour on the CLI).

### Integration in Web Applications

Include the browser bundle in your web application:

```html
<!-- Load Mocha and dependencies -->
<script src="https://unpkg.com/mocha@10.2.0/mocha.js"></script>
<script src="https://unpkg.com/chai@4.3.10/chai.js"></script>

<!-- Load AJV for JSON schema validation -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/ajv/8.17.1/ajv2020.bundle.min.js"></script>

<!-- Load JSON-LD for JSON-LD validation -->
<script src="https://unpkg.com/jsonld@8/dist/jsonld.min.js"></script>

<!-- Load eyereasoner for tier 3 graph validation -->
<script src="https://eyereasoner.github.io/eye-js/18/latest/index.js"></script>

<!-- Initialize Mocha -->
<script>
  mocha.setup('bdd');
</script>

<!-- Load UNTP Test Suite -->
<script src="browser-bundle.js"></script>

<script>
  // Set up credential data
  const credentialData = new Map();
  credentialData.set('credential.json', '{"@context": [...], "type": [...]}');
  setCredentialData(credentialData);

  // Add trusted issuer DID
  const trustedDIDs = ['did:web:abr.business.gov.au'];
  untpTestSuite.trustedDIDs.length = 0;
  untpTestSuite.trustedDIDs.push(...trustedDIDs);

  // Run tests with extension schema mappings
  const runner = new UNTPTestRunner();
  const results = await runner.run({
    tags: ['tier1'], // Optional tag filtering
    extensionSchemaMaps: [extensionMappingObject], // Optional extension mappings
    mochaSetupCallback: (mochaOptions) => {
      const mocha = new Mocha(mochaOptions);
      mocha.cleanReferencesAfterRun(false);
      return mocha;
    }
  }, (event) => {
    // Handle streaming test results
    console.log(`${event.type}:`, event.data);
  });

  console.log('Tests completed:', results.success ? 'PASSED' : 'FAILED');
</script>
```

See the [example browser-test](browser-test) for more info.

## Programmatic Usage

### Node.js

```typescript
import { UNTPTestRunner, setCredentialData, trustedDIDs } from 'untp-test-suite-mocha';
import * as fs from 'fs';

// Set up credential data (replace 'credential.json' with your credential file path)
const credentialData = new Map();
const content = fs.readFileSync('credential.json', 'utf8');
credentialData.set('credential.json', content);
setCredentialData(credentialData);

// Add trusted issuer DID
const trustedDIDs = ['did:web:abr.business.gov.au'];
trustedDIDs.length = 0;
trustedDIDs.push(...trustedDIDs);

// Run tests with extension schema mappings
const runner = new UNTPTestRunner();
const results = await runner.run(
  {
    tags: ['tier1', 'validation'],
    extensionSchemaMaps: ['./extensions/custom-mappings.json'], // Optional extension mappings
    mochaSetupCallback: (mochaOptions) => {
      const Mocha = require('mocha');
      const mocha = new Mocha(mochaOptions);

      // Load test helpers
      require('./test-helpers');

      // Add test files
      mocha.addFile('./untp-tests/tier1/dummy.test.js');

      return mocha;
    },
  },
  (event) => {
    // Stream results in real-time
    if (event.type === 'pass') {
      console.log(`✔ ${event.data.title}`);
    } else if (event.type === 'fail') {
      console.log(`✖ ${event.data.title}`);
    }
  },
);

console.log(`Tests: ${results.stats.passes} passed, ${results.stats.failures} failed`);
```

See the [CLI untp-test command](src/bin/untp-test.ts) for more info.

## Available Tags

Tests can include any `tag:tagname` in their title to enable filtering by that tag when running tests in both the CLI and web environments.

## Extension Testing

The test suite automatically validates credentials with extension types. When a credential contains custom types (like `DigitalLivestockPassport`) before the standard UNTP type, the suite will:

1. **Detect Extension Types**: Automatically identify extension types in the credential's type array
2. **Validate Against Extension Schemas**: Create individual tests for each extension type found
3. **Use Schema Mappings**: Resolve extension schema URLs using provided mapping files

### Example Extension Credential

```json
{
  "type": ["DigitalLivestockPassport", "DigitalProductPassport", "VerifiableCredential"],
  "@context": ["https://www.w3.org/ns/credentials/v2", "..."],
  "credentialSubject": { "...": "..." }
}
```

This credential will generate tests for:

- W3C VerifiableCredential validation (Tier 1)
- DigitalProductPassport UNTP schema validation (Tier 2)
- DigitalLivestockPassport extension schema validation (Tier 2)

### Custom Test Suites

For additional custom test logic, add your test files in the `mochaSetupCallback`:

```typescript
mochaSetupCallback: (mochaOptions) => {
  const mocha = new Mocha(mochaOptions);

  // Add built-in tests
  mocha.addFile('./untp-tests/tier1/basic.test.js');

  // Add your custom tests
  mocha.addFile('./my-tests/custom-validation.test.js');

  return mocha;
};
```

This will be exposed in the CLI at a later point.

## API Reference

### UNTPTestRunner

Main test execution class that works in both Node.js and browser environments.

#### `run(options, onStream?): Promise<UNTPTestResults>`

- **options**: `UNTPTestOptions` - Test configuration
- **onStream**: `(event: StreamEvent) => void` - Optional streaming callback to receive real-time events for test execution
- **returns**: `Promise<UNTPTestResults>` - Test execution results

## License

MIT License - see LICENSE file for details.

## Related Projects

The following projects both within this repository are potential users of this new untp-test-suite:

- [UNTP Playground](../untp-playground) - Web interface for UNTP credential testing that I envisage will use this new untp-test-suite.
- [tests-untp E2E](../../e2e) - end to end test that is currently the only library using the existing untp-test-suite.
