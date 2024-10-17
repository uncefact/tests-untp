---
sidebar_position: 41
title: Credential Status
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The Credential Status is being injected into the Verifiable Credential (VC) to manage the status of the VC. The status can be used to activate or revoke the VC. The status is managed by the issuer of the VC.

## Diagram

The sequence diagram below illustrates the flow of injecting the status into the VC:

```mermaid

sequenceDiagram

participant C as Client

participant MA as Mock App

participant V as VCKit

participant S as Storage

participant D as DLR

C->>MA: Call issue a VC (data, context)

MA->>MA: Validate context

MA->>MA: Extract identifier

MA->>MA: Check if the data contains a credential status

alt Status is not present
  MA ->> V: Issue new credential status
  V -->> MA: Return credential status
end

MA ->> MA: Inject status into VC payload

MA->>V: Issue VC

V-->>MA: Return VC

MA->>S: Upload VC

S-->>MA: Return VC URL

MA->>D: Register link resolver

D-->>MA: Return resolver URL

MA-->>C: Return VC and resolver URL

```

## Managing the status of a Verifiable Credential

To manage the status of a Verifiable Credential ([activate](https://uncefact.github.io/project-vckit/docs/get-started/api-server-get-started/basic-operations#activating-a-vc) or [revoke](https://uncefact.github.io/project-vckit/docs/get-started/api-server-get-started/basic-operations#revoking-a-vc)), you can refer to the [VCkit](https://uncefact.github.io/project-vckit/docs/) documentation.

