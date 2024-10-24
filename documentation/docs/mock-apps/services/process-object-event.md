---
sidebar_position: 26
title: Process Object Event
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `processObjectEvent` service is responsible for processing an [Object Event (DTE)](https://uncefact.github.io/spec-untp/docs/specification/DigitalTraceabilityEvents), issuing a [Verifiable Credential (VC)](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials), uploading it to the [Storage service](/docs/mock-apps/dependent-services/storage-service), registering the link to the stored DTE with the [Identity Resolver service](/docs/mock-apps/dependent-services/identity-resolution-service). It handles the entire lifecycle of creating and managing an object event, from data input to storage and resolution.

## Diagram

```mermaid
sequenceDiagram
participant C as Client
participant P as processObjectEvent
participant V as VCKit
participant S as Storage
participant D as DLR
C->>P: Call processObjectEvent(objectEvent, context)
P->>P: Validate context
P->>P: Extract identifier
P->>V: Issue VC
V-->>P: Return VC
P->>S: Upload VC
S-->>P: Return VC URL
P->>D: Register link resolver
D-->>P: Return resolver URL
P-->>C: Return object event VC and resolver URL
```

## Example

```json
{
  "name": "processObjectEvent",
  "parameters": [
    {
      "vckit": {
        "vckitAPIUrl": "http://localhost:3332/v2",
        "issuer": "did:web:uncefact.github.io:project-vckit:test-and-development",
        "headers": {
          "Authorization": "Bearer test123"
        }
      },
      "epcisObjectEvent": {
        "context": ["https://www.w3.org/2018/credentials/v1", "https://gs1.org/voc/"],
        "type": ["DigitalTraceabilityEvent"],
        "renderTemplate": [
          {
            "template": "<div><h2>Object Event</h2></div>",
            "@type": "WebRenderingTemplate2022"
          }
        ],
        "dlrIdentificationKeyType": "gtin",
        "dlrLinkTitle": "Object Event",
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
      "identifierKeyPath": "/id"
    }
  ]
}
```

## Definitions

| Property          | Required | Description                                                                                                                         | Type                                                            |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| vckit             | Yes      | Configuration for the VCKit service                                                                                                 | [VCKit](/docs/mock-apps/common/vckit)                           |
| epcisObjectEvent  | Yes      | Configuration for the EPCIS Object Event Event                                                                                      | [Credential](/docs/mock-apps/common/credential)                 |
| storage           | Yes      | Configuration for storage service                                                                                                   | [Storage](/docs/mock-apps/common/storage)                       |
| dlr               | Yes      | Configuration for the Digital Link Resolver                                                                                         | [IDR](/docs/mock-apps/common/idr)                               |
| identifierKeyPath | Yes      | JSON path to the identifier in the credential subject or the object for function and arguments of JSON path to construct identifier | [IdentifierKeyPath](/docs/mock-apps/common/identifier-key-path) |
