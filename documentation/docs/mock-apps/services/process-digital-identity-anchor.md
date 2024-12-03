---
sidebar_position: 43
title: Process Digital Identity Anchor
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `processDigitalIdentityAnchor` service is responsible for processing a digital identity anchor, issuing a [Verifiable Credential (VC)](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials), uploading it to the [Storage service](/docs/mock-apps/dependent-services/storage-service), registering the link to the stored digital identity anchor with the [Identity Resolver service](/docs/mock-apps/dependent-services/identity-resolution-service). It handles the entire lifecycle of creating and managing a digital identity anchor, from data input to storage and resolution.

## Diagram

```mermaid
sequenceDiagram
participant C as Client
participant P as processDigitalIdentityAnchor
participant V as VCKit
participant S as Storage
participant D as DLR
C->>P: Call processDigitalIdentityAnchor(digitalIdentityAnchor, context)
P->>P: Validate context
P->>P: Extract identifier
P->>V: Issue VC
V-->>P: Return VC
P->>S: Upload VC
S-->>P: Return VC URL
P->>D: Register link resolver
D-->>P: Return resolver URL
P-->>C: Return digital identity anchor VC and resolver URL
```

## Example

```json
{
  "name": "processDigitalIdentityAnchor",
  "parameters": [
    {
      "vckit": {
        "vckitAPIUrl": "http://localhost:3332/v2",
        "issuer": "did:web:uncefact.github.io:project-vckit:test-and-development",
        "headers": {
          "Authorization": "Bearer test123"
        }
      },
      "digitalIdentityAnchor": {
        "context": ["https://www.w3.org/2018/credentials/v1", "https://gs1.org/voc/"],
        "type": ["DigitalIdentityAnchor"],
        "renderTemplate": [
          {
            "template": "<div><h2>DigitalIdentityAnchor</h2></div>",
            "@type": "WebRenderingTemplate2022"
          }
        ],
        "dlrLinkTitle": "DigitalIdentityAnchor",
        "dlrVerificationPage": "https://verify.example.com",
        "validUntil": "2025-11-28T04:47:15.136Z"
      },
      "storage": {
        "url": "http://localhost:3334/v1/documents",
        "params": {
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

| Property              | Required | Description                                                                                                                         | Type                                                            |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| vckit                 | Yes      | Configuration for the VCKit service                                                                                                 | [VCKit](/docs/mock-apps/common/vckit)                           |
| digitalIdentityAnchor | Yes      | Configuration for the Digital Identity Anchor                                                                                       | [Credential](/docs/mock-apps/common/credential)                 |
| storage               | Yes      | Configuration for storage service                                                                                                   | [Storage](/docs/mock-apps/common/storage)                       |
| dlr                   | Yes      | Configuration for the Digital Link Resolver                                                                                         | [IDR](/docs/mock-apps/common/idr)                               |
| identifierKeyPath     | Yes      | JSON path to the identifier in the credential subject or the object for function and arguments of JSON path to construct identifier | [IdentifierKeyPath](/docs/mock-apps/common/identifier-key-path) |

## Function type

| Type       | Description                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| ReturnData | It processes the input data or generates data independently and returns the processed result after successful execution. |
