# UNTP Test Suite

A reusable testing library for United Nations Transparency Protocol (UNTP) credentials that works in both Node.js CLI and browser environments, using [Mocha](https://mochajs.org/).

## Features

✅ **Both CLI and Browser Compatibility** - Same tests run in CLI and browser
✅ **Real-time Streaming Results** - Live test output with custom reporter
✅ **Tag-based Filtering** - Precise test selection with tags
✅ **TypeScript Support** - Full type safety and IntelliSense
✅ **Extension Schema Mapping** - Support for custom credential types with configurable schema validation

## Testing Tiers

The package enables running the three tiers of UNTP validation:

- **Tier 1**: W3C Verifiable Credential validation (JSON, JSON-LD, schema conformance)
- **Tier 2**: UNTP-specific credential type validation and required fields
- **Tier 3**: Graph inference, trust-chain verification, and claim conformance

## Installation

```bash
npm install untp-test-suite-mocha
```

## CLI Usage

### Basic Usage

Test credential files directly:

```bash
# Test single credential file
untp-test credential.json

# Test multiple files
untp-test credential1.json credential2.json credential3.json

# Test all credential files from directory
untp-test --directory ./credentials

# Combine individual files with directory scanning
untp-test credential.json --directory ./credentials
```

### Directory Scanning

The CLI can automatically find and test credential files from directories:

```bash
# Test all credential files in a directory
untp-test --directory ./example-credentials

# Short form
untp-test -d ./credentials

# Combine with individual files
untp-test specific-file.json --directory ./more-credentials

# With tag filtering
untp-test --directory ./credentials --tag tier1
```

**Supported file types**: `.json` and `.jsonld` files are automatically detected and included.

### Extension Schema Mapping

Test credentials with custom extension types by providing schema mapping files:

```bash
# Test extension credential with custom schema mapping
untp-test --extension-schema-map ./extensions/livestock-mapping.json credential.json

# Multiple extension mappings
untp-test --extension-schema-map ./ext1.json --extension-schema-map ./ext2.json credential.json

# Combine with directory scanning
untp-test --extension-schema-map ./mappings.json --directory ./credentials
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

See `src/untp-test/schema-mapper/default-mappings.json` for format example.

### Tag Filtering

Run only specific test types using tags:

```bash
# Run only Tier 1 tests
untp-test --tag tier1 credential.json

# Run only basic validation tests on directory
untp-test --tag basic --directory ./credentials

# Combine multiple tags
untp-test --tag tier1 --tag smoke --directory ./credentials

# Run validation and JSON-LD tests
untp-test --tag validation --tag jsonld credential.json
```

### Example Output

```
Adding credential files from directory: example-credentials
Found 5 credential files in directory
Testing 5 credential files

Running UNTP validation tests...

Tier 1 - W3C Verifiable Credential Validation (tags: tier1, w3c)
  ✔ should have access to credential state (tags: basic, integration) (1ms)
  product-passport.json
    ✔ should be a valid JSON-LD document (tags: jsonld) (598ms)
    ✔ should match the VerifiableCredential 1.1 schema (tags: jsonschema) (1ms)
Tier 2 - UNTP Schema Validation (tags: tier2, untp)
  ✔ should have access to credential state (tags: basic, integration)
  digital-livestock-passport.json
    ✔ should validate against DigitalProductPassport UNTP schema (tags: schema, untp-validation) (177ms)
    ✔ should validate against DigitalLivestockPassport extension schema (tags: schema, extension-validation) (499ms)

  6 passing (1275ms)
```

## Browser Usage

### Quick Start

1. Build the browser bundle:
```bash
npm run browser-test
```

2. Open `http://localhost:8080` in your browser

3. Upload credential files (.json or .jsonld) using drag & drop or file selection

4. Optionally add tags for filtering (e.g., `tier1`, `validation`, `smoke`)

5. Click "🚀 Run Tests" to see real-time results

### Features

- **Drag & Drop Upload** - Easy credential file selection
- **Tag Filtering** - Same tag system as CLI
- **Real-time Results** - Live streaming test output
- **Color-coded Output** - Green ✔ for pass, red ✖ for fail
- **Multiple Test Runs** - Run tests repeatedly without page reload

### Integration in Web Applications

Include the browser bundle in your web application:

```html
<!-- Load Mocha and Chai -->
<script src="https://unpkg.com/mocha@10.2.0/mocha.js"></script>
<script src="https://unpkg.com/chai@4.3.10/chai.js"></script>

<!-- Initialize Mocha -->
<script>mocha.setup('bdd');</script>

<!-- Load UNTP Test Suite -->
<script src="browser-bundle.js"></script>

<script>
// Set up credential data
const credentialData = new Map();
credentialData.set('credential.json', '{"@context": [...], "type": [...]}');
setCredentialData(credentialData);

// Run tests
const runner = new UNTPTestRunner();
const results = await runner.run({
  tags: ['tier1'], // Optional tag filtering
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

## Programmatic Usage

### Node.js

```typescript
import { UNTPTestRunner, setCredentialData } from 'untp-test-suite-mocha';
import * as fs from 'fs';

// Set up credential data
const credentialData = new Map();
const content = fs.readFileSync('credential.json', 'utf8');
credentialData.set('credential.json', content);
setCredentialData(credentialData);

// Run tests with extension schema mappings
const runner = new UNTPTestRunner();
const results = await runner.run({
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
  }
}, (event) => {
  // Stream results in real-time
  if (event.type === 'pass') {
    console.log(`✔ ${event.data.title}`);
  } else if (event.type === 'fail') {
    console.log(`✖ ${event.data.title}`);
  }
});

console.log(`Tests: ${results.stats.passes} passed, ${results.stats.failures} failed`);
```

## Available Tags

Tests can include any `tag:tagname` in their title to enable filtering by that tag when running tests in both the CLI and web environments.

### By Tier
Every test should have a tier tag:
- `tag:tier1` - W3C Verifiable Credential validation
- `tag:tier2` - UNTP-specific validation
- `tag:tier3` - Graph inference and trust chains

Other tags are completely optional, but could be used as per the examples below:

### By Test Type
- `tag:basic` - Basic functionality tests
- `tag:smoke` - Quick validation tests
- `tag:validation` - Data validation tests
- `tag:integration` - Integration tests

### By Technology
- `tag:json` - JSON structure validation
- `tag:jsonld` - JSON-LD context validation
- `tag:w3c` - W3C standard compliance

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
}
```

## Writing Custom Tests

Create test files using the standard Mocha BDD syntax with UNTP helpers. See the [standard UNTP tests](./untp-tests) for examples.

## API Reference

### UNTPTestRunner

Main test execution class that works in both Node.js and browser environments.

#### `run(options, onStream?): Promise<UNTPTestResults>`

- **options**: `UNTPTestOptions` - Test configuration
- **onStream**: `(event: StreamEvent) => void` - Optional streaming callback to receive real-time events for test execution
- **returns**: `Promise<UNTPTestResults>` - Test execution results

### UNTPTestOptions

```typescript
interface UNTPTestOptions {
  /** Tags to include (run only tests with these tags) */
  tags?: string[];
  /** Extension schema mapping files to load */
  extensionSchemaMaps?: string[];
  /** Callback to create and configure Mocha instance */
  mochaSetupCallback: (mochaOptions: any) => any;
}
```

### Credential State Functions

```typescript
// Set credential data for tests
setCredentialData(data: Map<string, string>): void

// Check if credentials are loaded
hasCredentials(): boolean

// Get all credentials as [filename, content] pairs
getAllCredentials(): Array<[string, string]>
```

## Development

### Building

```bash
# Build TypeScript
npm run build

# Build browser bundle
npm run build:browser

# Start development server
npm run browser-test
```

## License

MIT License - see LICENSE file for details.

## Related Projects

- [UNTP Playground](../untp-playground) - Web interface for UNTP credential testing
