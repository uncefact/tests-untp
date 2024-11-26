---
sidebar_position: 24
title: Process Transaction Event
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `processTransactionEvent` service is responsible for processing a [Transaction Event (DTE)](https://uncefact.github.io/spec-untp/docs/specification/DigitalTraceabilityEvents), issuing a [Verifiable Credential (VC)](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials), uploading it to the [Storage service](/docs/mock-apps/dependent-services/storage-service), registering the link to the stored DTE with the [Identity Resolver service](/docs/mock-apps/dependent-services/identity-resolution-service), and managing DPPs in local storage associated with the event. It handles the entire lifecycle of creating and managing a transaction event, from data input to storage, resolution, and local data management.

## Diagram

```mermaid
sequenceDiagram
participant C as Client
participant P as processTransactionEvent
participant V as VCKit
participant S as Storage
participant D as DLR
participant L as LocalStorage
C->>P: Call processTransactionEvent(transactionEvent, context)
P->>P: Validate context
P->>P: Extract identifier
P->>V: Issue VC
V-->>P: Return VC
P->>S: Upload VC
S-->>P: Return VC URL
P->>D: Register link resolver
D-->>P: Return resolver URL
P->>L: Delete associated DPPs from local storage
P-->>C: Return VC and resolver URL
```

## Example

```json
{
  "name": "processTransactionEvent",
  "parameters": [
    {
      "vckit": {
        "vckitAPIUrl": "http://localhost:3332/v2",
        "issuer": "did:web:uncefact.github.io:project-vckit:test-and-development",
        "headers": {
          "Authorization": "Bearer test123"
        }
      },
      "traceabilityEvent": {
        "context": ["https://www.w3.org/2018/credentials/v1", "https://gs1.org/voc/"],
        "type": ["DigitalTraceabilityEvent"],
        "renderTemplate": [
          {
            "type": "html",
            "template": "<div><h2>Transaction Event</h2><p>ID: {{transactionId}}</p></div>"
          }
        ],
        "dlrLinkTitle": "Transaction Event",
        "dlrVerificationPage": "https://verify.example.com"
      },
      "storage": {
        "url": "http://localhost:3334/v1/documents",
        "params": {
          "resultPath": "/uri",
          "bucket": "verifiable-credentials"
        },
        "options": {
          "method": "POST",
          "headers": {
            "Content-Type": "application/json"
          }
        }
      },
      "dlr": {
        "dlrAPIUrl": "https://dlr.example.com/api",
        "dlrAPIKey": "dlr-api-key-12345",
        "namespace": "gs1",
        "linkRegisterPath": "/api/resolver"
      },
      "identifierKeyPath": "/0/transactionId",
      "localStorageParams": {
        "storageKey": "transactionEvents",
        "keyPath": "/transactionId"
      }
    }
  ]
}
```

## Definitions

| Property           | Required | Description                                                                                                                         | Type                                                            |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| vckit              | Yes      | Configuration for the VCKit service                                                                                                 | [VCKit](/docs/mock-apps/common/vckit)                           |
| traceabilityEvent  | Yes      | Configuration for the EPCIS Transaction Event                                                                                       | [Credential](/docs/mock-apps/common/credential)                 |
| storage            | Yes      | Configuration for storage service                                                                                                   | [Storage](/docs/mock-apps/common/storage)                       |
| dlr                | Yes      | Configuration for the Digital Link Resolver                                                                                         | [IDR](/docs/mock-apps/common/idr)                               |
| identifierKeyPath  | Yes      | JSON path to the identifier in the credential subject or the object for function and arguments of JSON path to construct identifier | [IdentifierKeyPath](/docs/mock-apps/common/identifier-key-path) |
| localStorageParams | Yes      | Configuration for local storage management                                                                                          | [LocalStorage](/docs/mock-apps/common/local-storage)            |

## Function type

| Type       | Description                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| ReturnData | It processes the input data or generates data independently and returns the processed result after successful execution. |

