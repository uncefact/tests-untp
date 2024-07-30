---
sidebar_position: 41
title: Verify App
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

## Description

The Verify App is a crucial component of the [Scanning App](/docs/mock-apps/scanning-app), responsible for verifying UNTP credentials and displaying the verified credentials. It handles the decryption of encrypted Verifiable Credentials (VCs), verification through a dedicated service, and presentation of the results to the user. The main entrypoints into the Verify App are through the [Scanning App](/docs/mock-apps/scanning-app) or by a [Verify Link](/docs/mock-apps/common/verify-link).

## Overall Flow Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant V as Verify App
    participant SS as Storage Service
    participant VS as Verification Service
    U->>V: Access Verify App
    V->>SS: Fetch VC
    SS-->>V: Return VC
    V->>V: Decrypt VC (if required)
    V->>V: Compute Hash (if required)
    V->>VS: Send VC for Verification
    VS-->>V: Return Verification Result
    V->>V: Render Verified Credential
    V->>U: Display Verification Result and Credential
```