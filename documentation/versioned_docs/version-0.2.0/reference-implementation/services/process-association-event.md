---
sidebar_position: 44
title: Process Association Event
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `processAssociationEvent` service is responsible for processing an [Association Event (DTE)](https://uncefact.github.io/spec-untp/docs/specification/DigitalTraceabilityEvents), issuing a [Verifiable Credential (VC)](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials), uploading it to the [Storage service](/docs/reference-implementation/dependent-services/storage-service), registering the link to the stored DTE with the [Identity Resolver service](/docs/reference-implementation/dependent-services/identity-resolution-service). It handles the entire lifecycle of creating and managing an association event, from data input to storage and resolution.

## Diagram

```mermaid
sequenceDiagram
participant C as Client
participant P as processAssociationEvent
participant V as VCKit
participant S as Storage
participant D as DLR
C->>P: Call processAssociationEvent(associationEvent, context)
P->>P: Validate context
P->>P: Extract identifier
P->>V: Issue VC
V-->>P: Return VC
P->>S: Upload VC
S-->>P: Return VC URL
P->>D: Register link resolver
D-->>P: Return resolver URL
P-->>C: Return association event VC and resolver URL
```

## Example

```json
{
  "name": "processAssociationEvent",
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
        "context": [
          "https://jargon.sh/user/unece/traceabilityEvents/v/0.5.0/artefacts/jsonldContexts/traceabilityEvents.jsonld?class=traceabilityEvents"
        ],
        "type": ["VerifiableCredential", "DigitalTraceabilityEvent"],
        "renderTemplate": [
          {
            "template": "<div><h2>Association Event</h2></div>",
            "@type": "WebRenderingTemplate2022"
          }
        ],
        "dlrLinkTitle": "Association Event",
        "dlrVerificationPage": "https://verify.example.com",
        "validUntil": "2025-11-28T04:47:15.136Z"
      },
      "storage": {
        "url": "https://storage.example.com/upload",
        "params": {
          "bucket": "bucket-name"
        }
      },
      "dlr": {
        "dlrAPIUrl": "https://dlr.example.com/api",
        "dlrAPIKey": "dlr-api-key-12345",
        "namespace": "gs1",
        "linkRegisterPath": "resolver"
      },
      "identifierKeyPath": "/0/id"
    }
  ]
}
```

## Definitions

| Property          | Required | Description                                                                                                                              | Type                                                            |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| vckit             | Yes      | Configuration for the VCKit service                                                                                                      | [VCKit](/docs/reference-implementation/common/vckit)                           |
| traceabilityEvent | Yes      | Configuration for the EPCIS Association Event Event                                                                                      | [Credential](/docs/reference-implementation/common/credential)                 |
| storage           | Yes      | Configuration for storage service                                                                                                        | [Storage](/docs/reference-implementation/common/storage)                       |
| dlr               | Yes      | Configuration for the Digital Link Resolver                                                                                              | [IDR](/docs/reference-implementation/common/idr)                               |
| identifierKeyPath | Yes      | JSON path to the identifier in the credential subject or the association for function and arguments of JSON path to construct identifier | [IdentifierKeyPath](/docs/reference-implementation/common/identifier-key-path) |

## Function type

| Type       | Description                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| ReturnData | It processes the input data or generates data independently and returns the processed result after successful execution. |
