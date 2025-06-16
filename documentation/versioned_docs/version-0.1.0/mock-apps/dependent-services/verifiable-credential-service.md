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

### Setup Options

#### Option 1: Using Docker Compose (Recommended)

If you've chosen to use the Docker Compose setup as described in the [Dependent Services](/docs/mock-apps/dependent-services/) section, most of the configuration is already done for you. In this case, you only need to:

1. Create an identifier (did:web) within the Verifiable Credential Service.
2. Record this identifier for use in the mock app configuration.

#### Option 2: Manual Setup

If you're setting up your own instance of the Verifiable Credential Service, please follow these steps:

### VCKit Documentation

Please go through the VCKit documentation available [here](https://uncefact.github.io/project-vckit/) to understand how to set up and use VCKit.

### Requirements

To use the Verifiable Credential Service with the mock apps, you will need:
1. The VCKit API running.
2. An [Identifier](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials/#did-methods) (did:web) created and recorded for each actor in the value chain you would like to model.
3. The address of the VCKit API (e.g. http://localhost:3332/v2)
4. The API key of the VCkit API (if applicable)

Make sure you have these components set up and running, and note the API address, API key and Identifiers before proceeding with the mock app configuration.

### Creating an Identifier (did:web)

Regardless of which setup option you chose, you'll need to create an identifier (did:web) within the Verifiable Credential Service. This identifier is crucial for the proper functioning of the system.

To create an identifier, you'll need to use the VCKit API. Refer to the [VCKit documentation](https://uncefact.github.io/project-vckit/docs/get-started/api-server-get-started/basic-operations) for specific instructions on how to create a did:web identifier using their API endpoints.

In the next section, we will discuss the Storage Service and its role in the UNTP ecosystem.