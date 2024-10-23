---
sidebar_position: 46
title: Verifiable Credentials
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `Verifiable Credentials` is following the flow of the [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model/). It is a standard for issuing, presenting, and verifying credentials in a secure and privacy-preserving manner. Verifiable Credentials are tamper-proof, cryptographically signed documents that contain claims about a subject, such as a person, organization, or device. They are issued by trusted entities, known as issuers, and can be presented to verifiers to prove the authenticity of the claims.

---

## Credential Securing Mechanism

Verifiable Credentials rely on digital signatures or proofs to ensure the authenticity and integrity of the issued credentials. Two key securing mechanisms are used:

1. **Embedded Proofs**: The proof is included directly within the credential object, typically using JSON Web Signatures (JWS) or JSON-LD Signatures.
2. **Enveloping Proofs**: The proof wraps the entire credential as a container, using formats like:
   - **JOSE**: JSON Object Signing and Encryption, which enables signed credentials using JWS.
   - **COSE**: CBOR Object Signing and Encryption, used for compact and efficient serialization.

Credentials can also be encrypted if sensitive information must be protected. Encryption keys are managed through secure Key Management Systems (KMS) to ensure credentials remain confidential and tamper-proof.

---

Refer to the [Verifiable Credentials Data Model 2.0 - Securing Mechanisms](https://www.w3.org/TR/vc-data-model-2.0/#securing-mechanisms) for more information on the specification.

## Credential Payload Structure

The Credential when issuing will have payload follows the [Verifiable Credentials API v0.3](https://w3c-ccg.github.io/vc-api/#issue-credential) specification. A typical payload contains the following fields:

For EnvelopedVerifiableCredential:

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://www.w3.org/ns/credentials/examples/v2"],
  "type": "EnvelopedVerifiableCredential",
  "id": "data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWI6ZGRiYy0xMTYtMTA2LTE..."
}
```

For a JSON-LD Verifiable Credential with a proof:

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://www.w3.org/ns/credentials/examples/v2"],
  "id": "http://example.edu/credentials/1872",
  "type": ["VerifiableCredential", "AlumniCredential"],
  "issuer": "https://example.edu/issuers/14",
  "issuanceDate": "2023-03-21T19:23:24Z",
  "credentialSubject": {
    "id": "did:example:abcd1234",
    "alumniOf": "Example University"
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2023-03-21T19:23:24Z",
    "proofPurpose": "assertionMethod",
    "verificationMethod": "https://example.edu/issuers/14#key-1",
    "jws": "eyJhbGciOiJFZERTQSJ9..b9W5k8..."
  }
}
```

---

When verifying a credential, the verifier will call to the server to verify the credential. The server will return the verification result as follows:

```json
{
  "verified": true,
  ...
}
```

---

Refer to the [Verifiable Credentials API v0.3](https://w3c-ccg.github.io/vc-api/#verify-credential) for more information on the specification.
