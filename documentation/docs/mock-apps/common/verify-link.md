---
sidebar_position: 37
title: Verify Link
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />
<!-- TODO: Implement Verify link generator -->
## Description

The `Verify Link` is used to initiate the verification process for a verifiable credential, in the context of the Mock App system, a [Digital Product Passport (DPP)](https://uncefact.github.io/spec-untp/docs/specification/DigitalProductPassport), a [Digital Conformity Credential](https://uncefact.github.io/spec-untp/docs/specification/ConformityCredential) or [Digital Traceability Events](https://uncefact.github.io/spec-untp/docs/specification/DigitalTraceabilityEvents). It provides a standardised way to access, decrypt (if necessary), verify the authenticity and integrity of a credential, and render the credential on the [verify page](/docs/mock-apps/verify-app) of the Mock App system.

## Structure
The general structure of the verify link is as follows:

```
{verify_app_address}?q={payload:{uri:{uri_of_credential}, key:{decryption_key}, hash:{hash_of_credential}}}
```

## Components

1. `{verify_app_address}`: The base URL of the verification application.
2. `q`: Query parameter that contains the encoded payload.
3. `payload`: An object containing the necessary information for verification.
4. `uri`: The URI where the credential can be accessed.
5. `key` (optional): The decryption key, if the credential is encrypted.
6. `hash`: The hash of the credential for integrity verification.

## Encoded vs Decoded Query

### Decoded (Human-readable) Example:
```
http://localhost:3001/verify?q={payload:{uri:http://localhost:3001/conformity-credentials/steel-mill-1-emissions.json}}
```

### Encoded (URL-safe) Example:
```
http://localhost:3001/verify?q%3D%7Bpayload%3A%7Buri%3Ahttp%3A%2F%2Flocalhost%3A3001%2Fconformity-credentials%2Fsteel-mill-1-emissions.json%7D%7D
```

### Production Example:
```
https://www.example.com/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22https%3A%2F%2Fstorage.googleapis.com%2Fverifiable-credentials%2Fconformity-credentials%2Ftop-line-steel-dcc.json%22%7D%7D
```