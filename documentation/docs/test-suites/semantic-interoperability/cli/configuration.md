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
      "dataPath": "",
      "url": ""
    },
    {
      "type": "conformityCredential",
      "version": "v0.0.1",
      "dataPath": "",
      "url": ""
    },
    {
      "type": "objectEvent",
      "version": "v0.0.1",
      "dataPath": "",
      "url": ""
    },
    {
      "type": "productPassport",
      "version": "v0.0.1",
      "dataPath": "",
      "url": ""
    },
    {
      "type": "transactionEvent",
      "version": "v0.0.1",
      "dataPath": "",
      "url": ""
    },
    {
      "type": "transformationEvent",
      "version": "v0.0.1",
      "dataPath": "",
      "url": ""
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

### URL

The `url` value is the URL of the remote schema you want to test against. If you provide a URL, the `type` and `version` fields will be ignored.

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
      "dataPath": "credentials/aggregationEvent-sample.json",
      "url": ""
    },
    {
      "type": "conformityCredential",
      "version": "v0.0.1",
      "dataPath": "credentials/conformityCredential-sample.json",
      "url": ""
    },
    {
      "type": "objectEvent",
      "version": "v0.0.1",
      "dataPath": "credentials/objectEvent-sample.json",
      "url": ""
    },
    {
      "type": "productPassport",
      "version": "v0.0.1",
      "dataPath": "credentials/productPassport-sample.json",
      "url": ""
    },
    {
      "type": "transactionEvent",
      "version": "v0.0.1",
      "dataPath": "credentials/transactionEvent-sample.json",
      "url": ""
    },
    {
      "type": "transformationEvent",
      "version": "v0.0.1",
      "dataPath": "credentials/transformationEvent-sample.json",
      "url": ""
    }
  ]
}
```

You have now successfully configured the Tier 2 test suite to test your credentials against the core UNTP data model.

## Setting Up Configuration for the New Data Model

The Tier 2 test suite currently supports the existing UNTP data model. To test credentials with a new data model that includes the following schemas: Conformity Credential, Digital Facility Record, Traceability Events, and Product Passport, you can generate a configuration file.

Running the command `yarn run untp config` will create a configuration file containing the default values, structured as follows:

```json
{
  "credentials": [
    {
      "type": "conformityCredential",
      "version": "v0.5.0",
      "dataPath": "",
      "url": ""
    },
    {
      "type": "digitalFacilityRecord",
      "version": "v0.5.0",
      "dataPath": "",
      "url": ""
    },
    {
      "type": "traceabilityEvent",
      "version": "v0.5.0",
      "dataPath": "",
      "url": ""
    },
    {
      "type": "productPassport",
      "version": "v0.5.0",
      "dataPath": "",
      "url": ""
    }
  ]
}
```

The default version used will be the latest version of the schema. You can update the version to match the specific version of the schema you want to test against.

### You can add additional schemas in two ways:

#### 1. Add Directly to the Configuration File:

You can add an object representing the schema type and version directly to the credentials array in the configuration file, for example:

```json
{
  "type": "objectEvent",
  "version": "v0.3.10",
  "dataPath": "",
  "url": ""
}
```

#### 2. Add to Default Model in Code:

You can also add the name of the schema type to the `untpDefaultModel` in the packages/untp-test-suite/src/interfaces/utils/credentials.ts file as follows:

```typescript
export const untpDefaultModel = [
  'conformityCredential',
  'digitalFacilityRecord',
  'traceabilityEvent',
  'productPassport',
  'objectEvent',
];
```

Please remove the current `credentials.json` file, run `yarn build` and run the command `yarn run untp config` to generate a new configuration file with the updated schema types.
