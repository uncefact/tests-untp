---
sidebar_position: 40
title: Scanning App
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

## Description
The Scanning App is a dedicated page within the Mock App system, designed to enable users to scan barcodes and verify/view associated credentials. This page incorporates several key functions to manage the scanning and verification process efficiently. 

It begins by fetching the link to the associated passport from the [Identity Resolver service](/docs/mock-apps/dependent-services/identity-resolution-service) based on the identifier extracted from the barcode. The app then redirects to the [Verify App](/docs/mock-apps/verify-app), where it retrieves the credential from the [Storage service](/docs/mock-apps/dependent-services/storage-service). Subsequently, it sends the fetched Verifiable Credential to the [Verifiable Credential service](/docs/mock-apps/dependent-services/verifiable-credential-service) for verification. Finally, it displays the rendered Verified Credential to the user, completing the seamless process of credential verification and visualisation.


## Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant S as Scanning App
    participant V as Verifier
    participant IP as Identity Provider
    participant IDR as IDR Service
    participant SS as Storage Service
    participant VS as Verification Service

    U->>S: Scan Barcode
    S->>IP: Get IDR URL
    IP-->>S: Return IDR URL
    S->>IDR: Fetch Passport from IDR
    IDR-->>S: Return Passport
    S->>V: Redirect to Verify Page
    V->>SS: Fetch Verifiable Credential
    SS-->>V: Return Verifiable Credential
    V->>VS: Verify Credential
    VS-->>V: Return Verification Result
    V->>U: Display Verified Credential
```

## Configuration
The some components of the Scanning App can be configured by modifying the [configuration file](/docs/mock-apps/configuration/):

- [Apps configurations](/docs/mock-apps/configuration/system-config)
- [Identity provider settings](/docs/mock-apps/common/identify-provider)
- [Default verification service link](/docs/mock-apps/common/default-verification-service-link)

## Usage
To use the Scanning App:

- Navigate to the home page of the Mock App system.
- Select the Scanning option within the sidebar to open the barcode scanner.
- Scan a valid barcode containing an identifier associated with a product.
- The app will process the scanned data and redirect to the [Verify App](/docs/mock-apps/verify-app).
- The [Verify App](/docs/mock-apps/verify-app) will display the verified credential.