---
sidebar_position: 6  
title: Usage
---

import Disclaimer from './../../../_disclaimer.mdx';

<Disclaimer />

Once you have configured the test suite, you can run it to validate your UNTP credentials.

## Running the Test Suite

To run the test suite with the configuration defined in the [Configuration section](/docs/test-suites/semantic-interoperability/cli/configuration):

```bash
yarn run untp test
```

To use a specific configuration file:

```bash 
yarn run untp test --config path/to/credentials.json
```

## Test Results

The test suite validates each credential against its corresponding schema and provides a summary of results.

### Result Overview

For each tested credential, you will see:
- Credential type
- Version tested
- Test result status

### Result Categories

1. **Pass**: The credential fully conforms to the core UNTP data model without extensions.

2. **Warn**: The credential conforms to the core UNTP data model but includes extensions.
   - Review your extensions to ensure they are intentional.

3. **Fail**: The credential does not conform to the core UNTP data model.
   - Review and address each error to ensure compliance.

### Detailed Feedback

For warnings and failures, you will receive:
- Specific properties causing issues
- Brief descriptions of each problem
- Suggestions for resolution (where applicable)

## Next Steps

After successfully validating your credentials, you may want to explore extending the UNTP data model for your specific use case in the next section.