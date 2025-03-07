---
sidebar_position: 3
title: Verifiable Credentials
---

import Disclaimer from './../../../\_disclaimer.mdx';

<Disclaimer />

## Overview

The [Verifiable Credentials (VC)](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials) interoperability tests focus on ensuring that your implementation produces valid credentials conforming to the [W3C V2 Verifiable Credentials Data Model (VCDM)](https://www.w3.org/TR/vc-data-model-2.0/).

This section utilises an [external test suite](https://github.com/w3c/vc-data-model-2.0-test-suite) developed by the W3C community. The primary goal is to verify that the VCs produced by your system are compliant with the VCDM specification and can be correctly interpreted by other systems implementing the same standard.

For detailed testing procedures, please refer to the [Testing](./testing) page.

## Technical Interoperability Through Mutual Verification

Technical interoperability requires **two-way verification** between systems. This ensures:

- Credentials issued by one party can be validated by another.
- Both parties support the same standards (cryptography, DID methods, status checks).

### Mutual Verification Workflow

Technical interoperability depends on mutual trust—both parties must issue and verify credentials seamlessly. Testing this requires simulating the full cycle:

1. **Setup**:
   - Agree on standards (e.g., `Ed25519` signatures, `BitstringStatusListEntry`).
   - _Test_: Confirm both systems support the same DID methods and status mechanisms.
2. **Phase 1: Party A → Party B**
   - Party A issues a VC (e.g., a business license).
   - Party B verifies:
     - **DID Resolution**: Retrieves Party A’s public key from their DID.
     - **Status Check**: Confirms the credential is active (not revoked/expired).
     - **Proof Validation**: Validates the cryptographic signature.
   - _Test_: Simulate issuance and verify Party B accepts the VC.
3. **Phase 2: Party B → Party A** (repeat steps symmetrically).
4. **Success Criteria**:
   - Both verifications must succeed for interoperability.
   - _Test_: Ensure no errors in DID resolution, status, or proof checks across both directions.

---

## Verification Testing Components

### 1. DID Resolution

- Systems must resolve **Decentralized Identifiers (DIDs)** to retrieve public keys and service endpoints.
- Example: Resolving `did:web:example.com` to fetch the issuer’s public key for signature validation.
- _Test_: Use a DID resolver tool to confirm public key retrieval works across supported methods.

### 2. Status Checking

- Verify credentials are **not revoked, suspended, or expired**.
- Common mechanisms:
  - `BitstringStatusListEntry` (status lists).
- _Test_: Query the status list endpoint and validate against a revoked VC sample.

### 3. Securing Mechanisms

- Validate cryptographic proofs (e.g., digital signatures, enveloping proofs).
- Supported methods must align (e.g., Ed25519).
- _Test_: Generate a signed VC and verify its signature using a compatible library.

---

## Troubleshooting with W3C Test Suite

The **[W3C VC Data Model v2 Test Suite](https://github.com/w3c/vc-data-model-2.0-test-suite)** provides standardized test cases to debug interoperability issues, such as:

- Invalid or expired credentials.
- Revoked status checks.
- Schema mismatches.

Run these tests to identify and resolve failures in DID resolution, status checks, or proof validation.
