---
sidebar_position: 14
title: Service
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

Services are units of business logic that perform specific operations or interactions with external systems. They handle data processing, API calls, and other backend functionalities.

## Diagram

``` mermaid
graph TD
    A[Service]
    A --> B[Name]
    A --> C[Parameters]
    
    C --> C1[Parameter 1]
    C --> C2[Parameter 2]

    C1 --> D1[vckit]
    C1 --> D2[dpp]
    C1 --> D3[dlr]
    C1 --> D4[storage]
    C1 --> D5[identifierKeyPath]
```

## Config

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | Yes | The name of the service (depends on service used)| [Service](/docs/mock-apps/services/) |
| parameters | Yes | An array of parameter objects for the services (depends on service used)| [Service](/docs/mock-apps/services/) |

## Example

``` json
{
    "services": [
        {
            "name": "processObjectEvent",
            "parameters": [
                {
                    "vckit": {
                        "vckitAPIUrl": "http://localhost:3332/v2",
                        "issuer": "did:web:agtrace-passports.s3.ap-southeast-2.amazonaws.com"
                    },
                    "dpp": {
                        "context": [
                            "https://dpp-json-ld.s3.ap-southeast-2.amazonaws.com/dppld.json"
                        ],
                        "renderTemplate": [],
                        "type": [
                            "VerifiableCredential",
                            " DigitalProductPassport"
                        ],
                        "dlrLinkTitle": "Steel Passport",
                        "dlrIdentificationKeyType": "gtin",
                        "dlrVerificationPage": "http://localhost:3000/verify"
                    },
                    "dlr": {
                        "dlrAPIUrl": "http://localhost:8080",
                        "dlrAPIKey": "5555555555555"
                    },
                    "storage": {
                        "url": "http://localhost:3001/upload",
                        "params": {
                            "resultPath": "/url"
                        },
                        "options": {
                            "method": "POST",
                            "headers": {
                                "Content-Type": "application/json"
                            }
                        }
                    },
                    "identifierKeyPath": "/product/itemIdentifiers/0/identifierValue"
                }
            ]
        },
        {
            "name": "mergeToLocalStorage",
            "parameters": [
                {
                    "storageKey": "Steel_Mill_1_dpps",
                    "objectKeyPath": "/vc/credentialSubject/product/itemIdentifiers/0/identifierValue"
                }
            ]
        }
    ]
}
```
