---
sidebar_position: 7
title: Extensions
---

import Disclaimer from './../../../_disclaimer.mdx';

<Disclaimer />

The [United Nations Transparency Protocol (UNTP)](https://uncefact.github.io/spec-untp/) allows for extensions to its core data model. The UNTP Semantic Interoperability Test Suite can validate these extensions, ensuring they remain compliant with the core UNTP data model. This enables implementors to prototype and test custom credential types or additional properties while maintaining conformance with the UNTP protocol.

## Adding a Custom Schema

1. Create a new directory for your schema:

```
packages/
└── untp-test-suite/
    └── src/
        └── schemas/
            └── myCustomCredential/
                └── v0.0.1/
                    └── schema.json
```

2. Define your schema in `schema.json`, extending the core UNTP model as needed.

3. Update `credentials.json` to include your new credential type:

```json
{
  "credentials": [
    // ... existing credentials
    {
      "type": "myCustomCredential",
      "version": "v0.0.1",
      "dataPath": "credentials/myCustomCredential-sample.json"
    }
  ]
}
```

4. Create a sample credential file matching your schema.

5. Run the test suite to validate your extended credential:

```bash
yarn run untp test
```

By following these steps, you can prototype extensions to the UNTP data model while ensuring compatibility with the core specification.

Remember to thoroughly test your extensions and consider submitting valuable additions to the [UNTP community](https://github.com/uncefact/tests-untp) for potential inclusion in future versions of the protocol or submit your extension to the [extensions register](https://uncefact.github.io/spec-untp/docs/extensions).