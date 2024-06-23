---
sidebar_position: 24
title: Process Transaction Event
---

import Disclaimer from '../../_disclaimer.mdx';

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
        "vckitAPIUrl": "https://api.vckit.example.com",
        "issuer": "did:example:123456789abcdefghi"
      },
      "epcisTransactionEvent": {
        "context": ["https://www.w3.org/2018/credentials/v1", "https://gs1.org/voc/"],
        "type": ["VerifiableCredential", "EPCISTransactionEvent"],
        "renderTemplate": [
          {
            "type": "html",
            "template": "<div><h2>Transaction Event</h2><p>ID: {{transactionId}}</p></div>"
          }
        ],
        "dlrIdentificationKeyType": "gtin",
        "dlrLinkTitle": "Transaction Event",
        "dlrVerificationPage": "https://verify.example.com"
      },
      "storage": {
        "url": "https://storage.example.com/upload",
        "params": {
          "resultPath": "/url"
        }
      },
      "dlr": {
        "dlrAPIUrl": "https://dlr.example.com/api",
        "dlrAPIKey": "dlr-api-key-12345"
      },
      "identifierKeyPath": "/transactionId",
      "localStorageParams": {
        "storageKey": "transactionEvents",
        "keyPath": "/transactionId"
      }
    }
  ]
}
```

## Definitions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| vckit | Yes | Configuration for the VCKit service | [VCKit](/docs/mock-apps/common/vckit) |
| epcisTransactionEvent | Yes | Configuration for the EPCIS Transaction Event | [Credential](/docs/mock-apps/common/credential) |
| storage | Yes | Configuration for storage service | [Storage](/docs/mock-apps/common/storage) |
| dlr | Yes | Configuration for the Digital Link Resolver | [IDR](/docs/mock-apps/common/idr) |
| identifierKeyPath | Yes | JSON path to the identifier in the credential subject | String |
| localStorageParams | Yes | Configuration for local storage management | [LocalStorage](/docs/mock-apps/common/local-storage) |
