---
sidebar_position: 23
title: Process DPP
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `processDPP` service is responsible for processing a [Digital Product Passport (DPP)](https://uncefact.github.io/spec-untp/docs/specification/DigitalProductPassport), issuing a [Verifiable Credential (VC)](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials), uploading it to the [Storage service](/docs/mock-apps/dependent-services/storage-service), and registering the link to the stored DPP with the [Identity Resolver service](/docs/mock-apps/dependent-services/identity-resolution-service). It handles the entire lifecycle of creating and managing a DPP, from data input to storage and resolution.

## Diagram

```mermaid

sequenceDiagram

participant C as Client

participant P as processDPP

participant V as VCKit

participant S as Storage

participant D as DLR

C->>P: Call processDPP(data, context)

P->>P: Validate context

P->>P: Extract identifier

P->>V: Issue VC

V-->>P: Return VC

P->>S: Upload VC

S-->>P: Return VC URL

P->>D: Register link resolver

D-->>P: Return resolver URL

P-->>C: Return VC and resolver URL

```

## Example

```json
{
  "name": "processDPP",
  "parameters": [
    {
      "vckit": {
        "vckitAPIUrl": "http://localhost:3332/v2",
        "issuer": "did:web:uncefact.github.io:project-vckit:test-and-development",
        "headers": {
          "Authorization": "Bearer test123"
        }
      },
      "dpp": {
        "context": ["https://dpp-json-ld.s3.ap-southeast-2.amazonaws.com/dppld.json"],
        "renderTemplate": [
          {
            "template": "<!DOCTYPE html>...",
            "@type": "WebRenderingTemplate2022"
          }
        ],
        "type": ["DigitalProductPassport"],
        "dlrLinkTitle": "Steel Passport",
        "dlrVerificationPage": "http://localhost:3332/verify",
        "validUntil": "2025-11-28T04:47:15.136Z"
      },
      "dlr": {
        "dlrAPIUrl": "https://dlr.example.com",
        "dlrAPIKey": "5555555555555",
        "namespace": "gs1",
        "linkRegisterPath": "/api/resolver"
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
      "identifierKeyPath": "/product/itemIdentifiers/0/identifierValue"
    }
  ]
}
```

## Definitions

| Property          | Required | Description                                                                                                                         | Type                                                            |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| vckit             | Yes      | Configuration for the VCKit service                                                                                                 | [VCKit](/docs/mock-apps/common/vckit)                           |
| dpp               | Yes      | Configuration for the Digital Product Passport                                                                                      | [DPP](/docs/mock-apps/common/credential)                        |
| dlr               | Yes      | Configuration for the Digital Link Resolver                                                                                         | [IDR](/docs/mock-apps/common/idr)                               |
| storage           | Yes      | Configuration for storage service                                                                                                   | [Storage](/docs/mock-apps/common/storage)                       |
| identifierKeyPath | Yes      | JSON path to the identifier in the credential subject or the object for function and arguments of JSON path to construct identifier | [IdentifierKeyPath](/docs/mock-apps/common/identifier-key-path) |

## Function type

| Type       | Description                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| ReturnData | It processes the input data or generates data independently and returns the processed result after successful execution. |
