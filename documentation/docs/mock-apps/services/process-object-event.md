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
loop For each item
P->>V: Issue DPP VC linked object resolver URL
V-->>P: Return DPP VC
P->>S: Upload DPP VC
S-->>P: Return DPP VC URL
P->>D: Register DPP link resolver
D-->>P: Return DPP resolver URL
end
P-->>C: Return object event VC and resolver URL
```

## Example

```json
{
  "name": "processObjectEvent",
  "parameters": [
    {
      "vckit": {
        "vckitAPIUrl": "https://api.vckit.example.com",
        "issuer": "did:example:123456789abcdefghi"
      },
      "epcisObjectEvent": {
        "context": ["https://www.w3.org/2018/credentials/v1", "https://gs1.org/voc/"],
        "type": ["VerifiableCredential", "ObjectEventCredential"],
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
        "url": "https://storage.example.com/upload",
        "params": {
          "resultPath": "/url"
        }
      },
      "dlr": {
        "dlrAPIUrl": "https://dlr.example.com/api",
        "dlrAPIKey": "dlr-api-key-12345",
        "namespace": "gs1",
        "linkRegisterPath": "/api/resolver"
      },
      "identifierKeyPath": "/parentItem/epc",
      "dpp": {
        "dlrIdentificationKeyType": "gtin",
        "dlrLinkTitle": "Product DPP",
        "dlrVerificationPage": "https://verify.example.com"
      },
      "dppCredential": {
        "mappingFields": [
          {
            "sourcePath": "/linkResolver",
            "destinationPath": "/traceabilityInformation/0/eventReference"
          }
        ],
        "dummyFields": [
          {
            "path": "/traceabilityInformation/0/eventType",
            "data": "object"
          }
        ]
      }
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
| dpp               | Yes      | Configuration for the DPP that configuration will be used to issue new DPPs event                                                   | [Credential](/docs/mock-apps/common/credential)                 |
| dppCredential     | Yes      | Configuration for the DPP credential to add the object event                                                                        | [Construct Data](/docs/mock-apps/common/construct-data)         |
