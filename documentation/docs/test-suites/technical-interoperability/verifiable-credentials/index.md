---
sidebar_position: 3
title: Verifiable Credentials
---

import Disclaimer from './../../../\_disclaimer.mdx';

<Disclaimer />



# Verifiable Credential (VC) Verification

The UNTP Playground enables implementers to upload UNTP-compliant credentials, such as Digital Product Passports, for testing. Uploading a credential to the playground initiates a testing process that evaluates the credential against multiple categories. One key category is adherence to the [W3C Verifiable Credentials Data Model (VCDM) v2](https://www.w3.org/TR/vc-data-model-2.0/) and additional criteria outlined in the [Verifiable Credentials section](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials) of the UNTP specification, achieved through mutual verification.

## Mutual Verification in the UNTP Playground

Mutual verification in the [UNTP Playground](https://test.uncefact.org/untp-playground) is a two-stage process ensuring that both the implementer and the Playground can issue and verify credentials compliant with the W3C VCDM v2 and UNTP specifications. The process comprises:

- **Stage 1**: Implementers upload a VC to the Playground, which tests it against the verification steps outlined in the Verification Process section.
- **Stage 2**: Implementers download a UNTP-issued test credential from the Playground and verify it within their own VC implementation, as detailed in the Verifying Your Implementation section.

This two-stage approach promotes interoperability by confirming that both parties adhere to the same standards.

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
   Confirm that the credential was issued by the claimed issuer, has not been tampered with and is within the validity period if specified. This involves:

   - Fetching the issuer's DID document.
   - Obtaining the issuer's public key from the DID document.
   - Verifying the credential's signature using the public key.
   - Checking the `validFrom` and `validUntil` properties to ensure the credential is within its validity period.

   If the credential has been tampered with, the public key is incorrect or is outside of the validity period, the test will fail. These checks are abstracted within a verifiable credential service (e.g., VCkit) and exposed via an API endpoint (e.g., `http://localhost:3332/agent/routeVerificationCredential`).

3. **Validate Schema Conformance**  
   Ensure the decoded credential adheres to the [VCDM v2 schema](https://w3c.github.io/vc-data-model/schema/verifiable-credential/verifiable-credential-schema.json), verifying correct data types, required properties, and structural integrity.

4. **Test JSON-LD Context Expansion**  
   Expand the decoded credential's [JSON-LD context](https://www.w3.org/ns/credentials/v2) to confirm:

   - All terms are defined.
   - No terms conflict with protected terms.
   - The expansion process completes without errors.

5. **Check Credential Status**  
   Verify the credential's status (e.g., active, revoked) using the value of `credentialStatus` within the credential, if present, ensuring the status method complies with the UNTP specification's permitted `BitstringStatusListEntry` and that the credential has not been revoked. This process is abstracted behind an API endpoint of the verifiable credential service (e.g., VCkit `http://localhost:3332/agent/routeVerificationCredential`).

## Verifying Your Implementation

To complete the mutual verification process, implementers must verify the UNTP-issued test credential within their own VC implementation. Follow these steps:

1. **Download the Test Credential**  
   Obtain the UNTP-issued VC from the Playground, available for download via the [Playground interface](https://test.uncefact.org/untp-playground).

2. **Verify the Credential**  
   Using your VC implementation, perform the following checks on the downloaded credential:

   - Confirm the credential is secured with an enveloping proof in the format specified in the Verification Process.
   - Verify the signature by fetching the issuer's DID document, obtaining the public key, and checking the signature.
   - Validate schema conformance against the VCDM v2 schema.
   - Test JSON-LD context expansion to ensure all terms are defined and no conflicts occur.
   - Check the credential status using the value of the `credentialStatus` property, if present, ensuring compliance with `BitstringStatusListEntry`.
   - Validate the `validFrom` and `validUntil` properties to ensure the credential is within validity period.

3. **Resolve Issues**  
   If verification fails, refer to the Troubleshooting and Resources section for guidance.

Successful verification of both the credential uploaded to the Playground and the UNTP-issued credential within your implementation confirms interoperability with the verifiable credential requirements outlined in the UNTP specification.

## Troubleshooting and Resources

If issues arise during verification, implementers should:

- Refer to the [W3C VCDM v2 Specification](https://www.w3.org/TR/vc-data-model-2.0/) for detailed requirements.
- Consult the [W3C VCDM v2 Test Suite](https://github.com/w3c/vc-data-model-2.0-test-suite) (note: still under active development).
- Ensure documents can be expanded without error see [JSON-LD spec](https://json-ld.org/) and [tooling](https://json-ld.org/#developers).

## Future Enhancements

Before the UNTP Playground v1.0.0 release, additional test steps will be added to validate service endpoints within the issuer's DID document, see more information [here](https://uncefact.github.io/spec-untp/docs/specification/DigitalIdentityAnchor#via-did-service-endpoint).

