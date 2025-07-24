# UNTP Test Suite

A reusable testing library for United Nations Transparency Protocol (UNTP) credentials that works in both Node.js CLI and browser environments, using [Mocha](https://mochajs.org/).

## Features

✅ **Both CLI and Browser Compatibility** - Same tests run in CLI and browser
✅ **Real-time Streaming Results** - Live test output with custom reporter
✅ **Tag-based Filtering** - Precise test selection with tags
✅ **TypeScript Support** - Full type safety and IntelliSense
✅ **Extensible Architecture** - Support for including custom test suites for extensions (CLI-only currently)

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

# Add files from directory (coming soon)
untp-test --directory ./credentials credential.json
```

### Tag Filtering

Run only specific test types using tags:

```bash
# Run only Tier 1 tests
untp-test --tag tier1 credential.json

# Run only basic validation tests
untp-test --tag basic credential.json

# Combine multiple tags
untp-test --tag tier1 --tag smoke credentials/*.json

# Run validation and JSON-LD tests
untp-test --tag validation --tag jsonld credential.json
```

### Example Output

```
Testing credential files: product-passport.json, identity-anchor.json

Running UNTP validation tests...

  Tier 1 - W3C Verifiable Credential Validation tag:tier1 tag:w3c
    ✔ dummy test should pass tag:basic tag:smoke (2ms)
    ✔ should have access to credential files tag:basic tag:integration (5ms)
    ✔ should validate JSON structure for all credential files tag:json tag:validation (1ms)
    ✔ should validate JSON-LD context in credential files tag:jsonld tag:validation (3ms)

  4 passing (15ms)
```

## Browser Usage

### Quick Start

1. Build the browser bundle:
```bash
npm run browser-test
```

2. Open `http://localhost:8080` in your browser

3. Upload credential files (.json) using drag & drop or file selection

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

// Run tests
const runner = new UNTPTestRunner();
const results = await runner.run({
  tags: ['tier1', 'validation'],
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

Add your own test suites by providing additional test directories:

```bash
# CLI with extensions (coming soon)
untp-test --additional-tests ./my-custom-tests credential.json
```

For programmatic usage, add your test files in the `mochaSetupCallback`:

```typescript
mochaSetupCallback: (mochaOptions) => {
  const mocha = new Mocha(mochaOptions);

  // Add built-in tests
  mocha.addFile('./untp-tests/tier1/dummy.test.js');

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
