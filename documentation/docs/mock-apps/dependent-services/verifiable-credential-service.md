---
sidebar_position: 5
title: Verifiable Credential Service
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

The Verifiable Credential Service is a crucial component of the [United Nations Transparency Protocol (UNTP)](https://uncefact.github.io/spec-untp) ecosystem.

It provides the following functionality:
- Creation of [decentralised identifiers (DIDs)](https://w3c-ccg.github.io/did-method-web/) for each actor in the value chain.
- Issuance of [Digital Product Passports](https://uncefact.github.io/spec-untp/docs/specification/DigitalProductPassport), [Conformity Credentials](https://uncefact.github.io/spec-untp/docs/specification/ConformityCredential), and [Traceability Events](https://uncefact.github.io/spec-untp/docs/specification/DigitalTraceabilityEvents) as [W3C compliant verifiable credentials](https://www.w3.org/TR/vc-data-model-2.0/).
- Revocation functionality, allowing credentials to be revoked and activated after they have been issued.
- Verification of credentials.
- Rendering of credentials.

To learn more about why UNTP leverages verifiable credentials, refer to the [Verifiable Credentials documentation](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials) within the UNTP Spec.

For the Mock Apps, we recommend and will be using the UN's Verifiable Credential reference implementation called [VCKit](https://github.com/uncefact/project-vckit).

### VCKit Documentation

Please go through the VCKit documentation available [here](https://github.com/uncefact/project-vckit#start-the-documentation-page) to understand how to set up and use VCKit.

### Requirements

To use the Verifiable Credential Service with the mock apps, you will need:
<!-- TODO: VCkit API key missing from the app config implementation -->
1. The VCKit API running.
2. The VCKit Explorer app running.
3. An [Identifier](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials/#did-methods) (did:web) created and recorded for each actor in the value chain you would like to model.
4. The address of the VCKit API (e.g. http://localhost:3332/v2)
5. The API key of the VCkit API (if applicable)


Make sure you have these components set up and running, and note the API address, API key and Identifiers before proceeding with the mock app configuration.

In the next section, we will discuss the Storage Service and its role in the UNTP ecosystem.