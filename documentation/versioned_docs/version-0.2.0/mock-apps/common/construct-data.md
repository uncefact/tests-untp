---
sidebar_position: 34
title: Construct Data
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `constructData` object defines the schema for constructing event data, including field mappings, default values, and data generation rules. It is used in the [Json Form component](/docs/mock-apps/components/json-form) and is used when data needs to be mapped from one credential to another.

For example, when values from a DPP need to be mapped to properties within a transaction event or transformation event credential.

### Example

```json
{
    "mappingFields": [
        {
        "sourcePath": "/vc/credentialSubject/productIdentifier/0/identifierValue",
        "destinationPath": "/eventID"
        },
        {
        "sourcePath": "/vc/credentialSubject/productIdentifier/0/identifierValue",
        "destinationPath": "/epcList/index/name"
        },
        {
        "sourcePath": "/linkResolver",
        "destinationPath": "/epcList/index/itemID"
        }
    ],
    "dummyFields": [
        {
        "path": "/action",
        "data": "observe"
        },
        {
        "path": "/disposition",
        "data": "https://ref.gs1.org/cbv/Disp/in_transit"
        },
        {
        "path": "/bizStep",
        "data": "https://ref.gs1.org/cbv/BizStep/receiving"
        },
        {
        "path": "/bizLocation",
        "data": "https://example.com/warehouse"
        },
        {
        "path": "/sourceParty",
        "data": {
            "id": "did:web:api.acrs.pyx.io:top-line-steel",
            "name": "Top Line Steel",
            "identifiers": [
            {
                "scheme": "https://example.com/scheme/source",
                "identifierValue": "SRC123456",
                "binding": {
                "type": "w3c_vc",
                "assuranceLevel": "3rdParty",
                "reference": "https://example.com/source_evidence"
                }
            }
            ]
        }
        },
        {
        "path": "/destinationParty",
        "data": {
            "id": "did:web:api.acrs.pyx.io:steel-processor",
            "name": "Steel Processor",
            "identifiers": [
            {
                "scheme": "https://example.com/scheme/destination",
                "identifierValue": "DST7891011",
                "binding": {
                "type": "w3c_vc",
                "assuranceLevel": "3rdParty",
                "reference": "https://example.com/destination_evidence"
                }
            }
            ]
        }
        }
    ],
    "generationFields": [
        {
        "path": "/eventID",
        "handler": "generateIdWithSerialNumber"
        },
        {
        "path": "/eventTime",
        "handler": "generateCurrentDatetime"
        }
    ]
}
```

### Definitions

| Property | Required | Description | Type |
|----------|:--------:|-------------|------|
| mappingFields | No | An array of objects that define how data should be mapped from source paths to destination paths | [MappingFields](/docs/mock-apps/common/construct-data#mappingfields)[] |
| dummyFields | No | An array of objects that specify default values for certain fields in the event data | [DummyFields](/docs/mock-apps/common/construct-data#dummyfields)[] |
| generationFields | No | An array of objects that define fields whose values should be dynamically generated | [GenerationFields](/docs/mock-apps/common/construct-data#generationfields)[] |

#### mappingFields

| Property | Required | Description | Type |
|----------|:--------:|-------------|------|
| sourcePath | Yes | The path in the source data where the value should be taken from | String |
| destinationPath | Yes | The path in the destination data where the value should be placed | String |

#### dummyFields

| Property | Required | Description | Type |
| ---------|:--------:|-------------|------|
| path | Yes | The path in the event data where the default value should be set | String |
| data | Yes | The default value to be set at the specified path | Any |

#### generationFields
<!-- TODO: Determine where handlers are located -->
| Property | Required | Description | Type |
| ---------|:--------:|-------------|------|
| path | Yes | The path in the event data where the generated value should be set | String |
| handler | Yes | The name of the function or method that should be used to generate the value | Handler |

This structure allows for flexible data construction by mapping existing data, providing default values, and generating dynamic data as needed for the event. 

The `mappingFields` define how data is transferred from source to destination, `dummyFields` set default values, and `generationFields` specify which fields should have their values dynamically generated using specific handler functions.