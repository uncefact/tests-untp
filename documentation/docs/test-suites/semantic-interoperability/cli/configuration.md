---
sidebar_position: 5
title: Configuration
---

import Disclaimer from './../../../\_disclaimer.mdx';

<Disclaimer />

Before proceeding, we need to create the configuration file. The Tier 2 test suite config file defines the credentials being tested, the schema version to test against, and the location of the credential being tested.

## Generating the configuration file

To generate the configuration file, run the following command:

```bash
yarn run untp config
```

This will create a base configuration file named `credentials.json` in the base directory of the Tier 2 test suite folder: `tests-untp/packages/untp-test-suite/credentials.json`.

## Structure of the configuration file

The generated configuration file will have the following structure:

```json
{
  "credentials": [
    {
      "type": "aggregationEvent",
      "version": "v0.0.1",
      "dataPath": ""
    },
    {
      "type": "conformityCredential",
      "version": "v0.0.1",
      "dataPath": ""
    },
    {
      "type": "objectEvent",
      "version": "v0.0.1",
      "dataPath": ""
    },
    {
      "type": "productPassport",
      "version": "v0.0.1",
      "dataPath": ""
    },
    {
      "type": "transactionEvent",
      "version": "v0.0.1",
      "dataPath": ""
    },
    {
      "type": "transformationEvent",
      "version": "v0.0.1",
      "dataPath": ""
    }
  ]
}
```

### Credentials
The value of the credentials property is an array of objects containing information about the credential type (corresponding to a schema), the credential schema version, and the location of the credential to be tested.

### Schema and version structure

The schemas used in the test suite are located in the following directory structure:

```
packages/
└── untp-test-suite/
    └── src/
        └── schemas/
            ├── aggregationEvent/
            │   └── v0.0.1/
            │       └── schema.json
            ├── conformityCredential/
            │   └── v0.0.1/
            │       └── schema.json
            ├── objectEvent/
            │   └── v0.0.1/
            │       └── schema.json
            ├── productPassport/
            │   └── v0.0.1/
            │       └── schema.json
            ├── transactionEvent/
            │   └── v0.0.1/
            │       └── schema.json
            └── transformationEvent/
                └── v0.0.1/
                    └── schema.json
```

### Type
The `type` property value corresponds to the folder name within the `src/schemas` directory of the test suite. This allows logical grouping of schema versions. For example, `"type": "aggregationEvent"` corresponds to the `aggregationEvent` folder.

### Version
The `version` property value corresponds to the folder name within the respective credential type folder. For example, `"version": "v0.0.1"` corresponds to the `v0.0.1` folder within the credential type folder.

### Data Path

The `dataPath` value is the relative location of the credential you want to test against the schema type and version.

## Adding test credentials

To test credentials developed or produced by a UNTP implementation against the core UNTP data model:

1. Create a directory to store the credentials you want to test:

```bash
cd packages/untp-test-suite
mkdir credentials
```

2. Add the credentials you want to test to the directory created in the previous step. The files should have unique names and be in JSON format:

```
packages/
└── untp-test-suite/
    ├── credentials/
        ├── aggregationEvent-sample.json
        ├── conformityCredential-sample.json
        ├── objectEvent-sample.json
        ├── productPassport-sample.json
        ├── transactionEvent-sample.json
        └── transformationEvent-sample.json
```

3. Update the config file to point to the location of the credential you want to test within the corresponding object and save the file:

```json
{
  "credentials": [
    {
      "type": "aggregationEvent",
      "version": "v0.0.1",
      "dataPath": "credentials/aggregationEvent-sample.json"
    },
    {
      "type": "conformityCredential",
      "version": "v0.0.1",
      "dataPath": "credentials/conformityCredential-sample.json"
    },
    {
      "type": "objectEvent",
      "version": "v0.0.1",
      "dataPath": "credentials/objectEvent-sample.json"
    },
    {
      "type": "productPassport",
      "version": "v0.0.1",
      "dataPath": "credentials/productPassport-sample.json"
    },
    {
      "type": "transactionEvent",
      "version": "v0.0.1",
      "dataPath": "credentials/transactionEvent-sample.json"
    },
    {
      "type": "transformationEvent",
      "version": "v0.0.1",
      "dataPath": "credentials/transformationEvent-sample.json"
    }
  ]
}
```

You have now successfully configured the Tier 2 test suite to test your credentials against the core UNTP data model.