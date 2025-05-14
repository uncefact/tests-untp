---
sidebar_position: 3
title: Verifiable Credentials
---

import Disclaimer from './../../../\_disclaimer.mdx';

<Disclaimer />

# Verifiable Credential (VC) Verification

> **Disclaimer**: The mutual verification process described in this document is provisional and subject to updates as the UNTP Playground and testing processes mature. Implementers should check for the latest documentation and UNTP Playground releases for the most current procedures.

The [UNTP Playground](https://test.uncefact.org/untp-playground) enables implementers to upload UNTP-compliant credentials, such as Digital Product Passports (DPPs) or Digital Conformity Credentials (DCCs), for testing. Uploading a credential to the Playground initiates a testing process that evaluates the credential against multiple categories. One key category is adherence to the [W3C Verifiable Credentials Data Model (VCDM) v2](https://www.w3.org/TR/vc-data-model-2.0/) and additional criteria outlined in the [Verifiable Credentials section](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials) of the UNTP specification are achieved through mutual verification.

## Mutual Verification in the UNTP Playground

Mutual verification in the UNTP Playground is a two-stage process ensuring that both the implementer and the Playground can issue and verify credentials compliant with the W3C VCDM v2 and UNTP specifications. The process is designed to support UNTP-specific roles, such as a battery manufacturer issuing a DPP and an assessment company issuing a DCC, ensuring interoperability across these use cases. The process comprises:

- **Stage 1**: Implementers issue and upload their own VC (e.g., a DPP) to the Playground, which tests it against the verification steps outlined in the Verification Process section.
- **Stage 2**: Implementers download a UNTP-issued test credential (e.g., a DPP) from the Playground and verify it within their own VC implementation, as detailed in the Verifying Your Implementation section.

This two-stage approach promotes interoperability by confirming that both parties adhere to the [W3C Verifiable Credentials Data Model (VCDM) v2](https://www.w3.org/TR/vc-data-model-2.0/) standards, with stricter requirements as defined in the [UNTP Verifiable Credentials specification](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials). Specifically, implementations must use the `did:web` method for Decentralized Identifiers (DIDs), and for securing credentials with an enveloping proof, [JOSE](https://www.w3.org/TR/vc-jose-cose/) with the `EdDSA` algorithm using the `Ed25519` curve, and [BitstringStatusListEntry](https://www.w3.org/TR/vc-bitstring-status-list/) for credential revocation, ensuring interoperability across UNTP-compliant ecosystems.

### Example Scenario

To illustrate the role of Verifiable Credentials (VCs) in the UNTP ecosystem, consider an assessment company (Party A), a battery assembler (Party B), and a regulator (Party C) in a supply chain:

- **Stage 1**: Party A issues a Digital Conformity Credential (DCC) as a VC, attesting to the compliance of the assembled battery to a given standard, secured according to the [UNTP Verifiable Credentials specification](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials).
- **Stage 2**: Party B verifies Party A’s DCC to confirm its authenticity and compliance with UNTP specification, then issues a Digital Product Passport (DPP) as a VC for the assembled battery. The DPP embeds a link to the DCC to provide evidence of compliance, using the same UNTP standards.
- **Stage 3**: Party C verifies both the DCC and DPP VCs to confirm their authenticity and ensure the battery meets regulatory and sustainability standards.

This process ensures that Party A's DCC can be verified by Party B, and Party B's DPP can be verified by Party C, supporting the UNTP ecosystem's interoperability requirements. All parties conform to the same UNTP-compliant standards for securing and verifying VCs, using `did:web` for Decentralized Identifiers (DIDs), [JOSE](https://www.w3.org/TR/vc-jose-cose/) with the `EdDSA` algorithm (`Ed25519` curve) for enveloping proofs, and [BitstringStatusListEntry](https://www.w3.org/TR/vc-bitstring-status-list/) for credential revocation.

## Verification Process

The verification process ensures that an uploaded UNTP credential complies with the W3C VCDM v2 specification and the VC criteria specified in the UNTP specification. The UNTP Playground performs the following steps when an implementer uploads a credential:

1. **Verify Securing Mechanism**  
   The W3C VCDM v2 specification allows two [securing mechanisms (enveloping proof and embedded proofs)](https://www.w3.org/TR/vc-data-model-2.0/#securing-mechanisms), but the UNTP specification mandates the exclusive use of [enveloping proofs](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials#verifiable-credential-profile). The first step verifies that the uploaded credential is secured with an enveloping proof, and is in the following format:

   ```json
   {
     "@context": ["https://www.w3.org/ns/credentials/v2", "https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/"],
     "type": "EnvelopedVerifiableCredential",
     "id": "data:application/vc+jwt,eyJhbGciOiJFZERTQSIsImtpZCI6..."
   }
   ```

   Once confirmed, the credential is decoded for further processing.

2. **Verify Signature**  
   Confirm that the credential was issued by the claimed issuer, has not been tampered with, and is within the validity period if specified. This involves:

   - Fetching the issuer's DID document using the `did:web` method, as specified in the [UNTP specification](https://uncefact.github.io/spec-untp/docs/specification/DigitalIdentityAnchor#did-methods).
   - Obtaining the issuer's public key from the DID document.
   - Verifying the credential's [Ed25519 signature](https://ed25519.cr.yp.to/) using the public key.
   - Checking the `validFrom` and `validUntil` properties to ensure the credential is within its validity period.

   If the credential has been tampered with, the public key is incorrect, or it is outside the validity period, the test will fail. These checks are abstracted within a [verifiable credential service](/docs/mock-apps/dependent-services/verifiable-credential-service.md) and exposed via an API endpoint (e.g., `http://localhost:3332/agent/routeVerificationCredential`).

3. **Validate Schema Conformance**  
   Ensure the decoded credential adheres to the [VCDM v2 schema](https://w3c.github.io/vc-data-model/schema/verifiable-credential/verifiable-credential-schema.json), verifying correct data types, required properties, and structural integrity.

4. **Test JSON-LD Context Expansion**  
   Expand the decoded credential's [JSON-LD context](https://www.w3.org/ns/credentials/v2) to confirm:

   - All terms are defined.
   - No terms conflict with protected terms.
   - The expansion process completes without errors.

5. **Check Credential Status**  
   Verify the credential's status (e.g., active, revoked) using the value of `credentialStatus` within the credential, if present, ensuring the status method complies with the UNTP specification's permitted [BitstringStatusListEntry](https://www.w3.org/TR/vc-bitstring-status-list/) and that the credential has not been revoked. This process is abstracted behind an API endpoint of the [verifiable credential service](/docs/mock-apps/dependent-services/verifiable-credential-service.md) (e.g., `http://localhost:3332/agent/routeVerificationCredential`).

## Verifying Your Implementation

To complete the mutual verification process, implementers must verify the UNTP-issued test credential within their own VC implementation. Follow these steps:

1. **Download the Test Credential**  
   Obtain the UNTP-issued VC (e.g., a DPP) from the Playground, available for download via the [Playground interface](https://test.uncefact.org/untp-playground).

2. **Verify the Credential**  
   Using your VC implementation, perform the following checks on the downloaded credential:

   - Confirm the credential is secured with an enveloping proof in the format specified in the Verification Process.
   - Verify the [Ed25519 signature](https://ed25519.cr.yp.to/) by fetching the issuer's DID document using `did:web`, obtaining the public key, and checking the signature.
   - Validate schema conformance against the [VCDM v2 schema](https://w3c.github.io/vc-data-model/schema/verifiable-credential/verifiable-credential-schema.json).
   - Test JSON-LD context expansion to ensure all terms are defined and no conflicts occur.
   - Check the credential status using the value of the `credentialStatus` property, if present, ensuring compliance with [BitstringStatusListEntry](https://www.w3.org/TR/vc-bitstring-status-list/).
   - Validate the `validFrom` and `validUntil` properties to ensure the credential is within its validity period.

3. **Resolve Issues**  
   If verification fails, refer to the Troubleshooting and Resources section for guidance.

Successful verification of both the credential you upload to the Playground and the test credential provided by the Playground within your own implementation demonstrates that your solution is interoperable with the verifiable credential requirements outlined in the UNTP specification.

## Troubleshooting and Resources

If issues arise during verification, implementers should:

- Refer to the [W3C VCDM v2 Specification](https://www.w3.org/TR/vc-data-model-2.0/) for detailed requirements.
- Consult the [W3C VCDM v2 Test Suite](https://github.com/w3c/vc-data-model-2.0-test-suite) (note: still under active development).
- Ensure documents can be expanded without error; see [JSON-LD spec](https://json-ld.org/) and [tooling](https://json-ld.org/#developers).
- Check the [UNTP specification](https://uncefact.github.io/spec-untp/docs/specification/) for additional requirements.

## Future Enhancements

Before the UNTP Playground v1.0.0 release, additional test steps will be added to validate service endpoints within the issuer's DID document, as described in the [UNTP specification](https://uncefact.github.io/spec-untp/docs/specification/DigitalIdentityAnchor#via-did-service-endpoint).
