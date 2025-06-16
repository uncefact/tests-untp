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
      "type": "digitalConformityCredential",
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
      "type": "digitalProductPassport",
      "version": "v0.5.0",
      "dataPath": "",
      "url": ""
    },
    {
      "type": "digitalTraceabilityEvent",
      "version": "v0.5.0",
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

The `url` property allows you to specify a remote schema URL for testing. When provided, this URL takes precedence and the test suite will use the remote schema instead of looking up the local schema based on `type` and `version`. This is useful when you want to test against schemas hosted elsewhere.

## Adding test credentials

Follow these steps to validate your UNTP implementation's credentials against the core UNTP data model specifications:

1. Navigate to the test suite directory:

```bash
cd packages/untp-test-suite
```

2. Add your credential files to the appropriate subdirectory under `credentials/`. The directory structure should match the credential type:

```
packages/
└── untp-test-suite/
    └── credentials/
        ├── conformityCredential/
        │   └── DigitalConformityCredential_instance-v0.5.0.
        ├── digitalFacilityRecord/
        │   └── DigitalFacilityRecord_instance-v0.5.0.json
        ├── productPassport/
        │   └── DigitalProductPassport_instance-v0.5.0.json
        └── traceabilityEvents/
            └── DigitalTraceabilityEvent_instance-v0.5.0.json
```

3. Update the config file (`credentials.json`) to point to your credential files:

```json
{
  "credentials": [
    {
      "type": "digitalConformityCredential",
      "version": "v0.5.0",
      "dataPath": "credentials/conformityCredential/DigitalConformityCredential_instance-v0.5.0.json",
      "url": ""
    },
    {
      "type": "digitalFacilityRecord",
      "version": "v0.5.0",
      "dataPath": "credentials/digitalFacilityRecord/DigitalFacilityRecord_instance-v0.5.0.json",
      "url": ""
    },
    {
      "type": "digitalProductPassport",
      "version": "v0.5.0",
      "dataPath": "credentials/productPassport/DigitalProductPassport_instance-v0.5.0.json",
      "url": ""
    },
    {
      "type": "digitalTraceabilityEvent",
      "version": "v0.5.0",
      "dataPath": "credentials/traceabilityEvents/DigitalTraceabilityEvent_instance-v0.5.0.json",
      "url": ""
    }
  ]
}
```

Each credential entry in the configuration should specify:

- `type`: The credential type (matching the schema directory name)
- `version`: The schema version to test against
- `dataPath`: Relative path to your credential file
- `url`: Optional URL to a remote schema (leave empty to use local schemas)

You have now successfully configured the Tier 2 test suite to test your credentials against the core UNTP data model.

## Running the test suite

Once your configuration file is set up, run the test suite with the following command:

```bash
cd packages/untp-test-suite
yarn run untp test
```

## Testing Industry-Specific Extensions of UNTP

The Tier 2 test suite not only supports the core UNTP data model but also allows testing of industry-specific extensions, such as the Australian Agriculture Traceability Protocol (AATP) or the UN Critical Raw Materials Transparency Protocol (CRMTP).

This flexibility enables implementors to verify conformance with both the core UNTP data models and their specific industry extensions.

### Example: Testing the Australian Agriculture Traceability Protocol (AATP) Extension

In this example, we'll demonstrate how to test the Australian Agriculture Traceability Protocol (AATP) extension using a Digital Livestock Passport (DLP). There are two ways to provide your extension schema for testing:

#### Method 1: Local Schema Directory

Add your extension schema to the core schemas directory:

```
packages/
└── untp-test-suite/
    ├── src/
    │   └── schemas/  # All schemas live here
    │       ├── digitalProductPassport/
    │       │   └── v0.5.0/
    │       │       └── schema.json
    │       ├── digitalLivestockPassport/ # Your extension
    │       │   └── v0.5.0/
    │       │       └── schema.json
    │       └── ...
    │
    ├── credentials/ # Test credentials directory
    │   └── aatp/
    │       └── livestock/
    │           └── DigitalLivestockPassport_instance-v0.5.0.json
```

Then reference it in your `credentials.json`:

```json
{
  "credentials": [
    {
      "type": "digitalLivestockPassport",
      "version": "v0.5.0",
      "dataPath": "credentials/aatp/livestock/DigitalLivestockPassport_instance-v0.5.0.json",
      "url": ""
    }
  ]
}
```

```bash
cd packages/untp-test-suite
yarn build
yarn run untp test
```

#### Method 2: Remote Schema URL

Alternatively, you can reference a remotely hosted schema:

```json
{
  "credentials": [
    {
      "type": "digitalLivestockPassport",
      "version": "v0.5.0",
      "dataPath": "credentials/aatp/livestock/DigitalLivestockPassport_instance-v0.5.0.json",
      "url": "https://example.com/schemas/dlp/0.5.0/digitalLivestockPassport.json"
    }
  ]
}
```

```bash
cd packages/untp-test-suite
yarn run untp test
```

When using a remote URL, the test suite will fetch the schema from the specified location instead of looking in the local schemas directory.

## Developers

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
  'digitalTraceabilityEvent',
  'digitalProductPassport',
  'digitalFacilityRecord',
  'digitalConformityCredential',
  'objectEvent',
];
```

Please remove the current `credentials.json` file, run `yarn build` and run the command `yarn run untp config` to generate a new configuration file with the updated schema types.
