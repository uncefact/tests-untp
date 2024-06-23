---
sidebar_position: 7
title: Identity Resolver Service
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

The Identity Resolver Service (IDR) is a critical component of the United Nations Transparency Protocol (UNTP) ecosystem. It serves as a bridge between the [identifiers of things (e.g., products, entities, transactions)](https://uncefact.github.io/spec-untp/docs/specification/Identifiers) and additional information about those things. You can learn more about Identity Resolver Services [here](https://uncefact.github.io/spec-untp/docs/specification/IdentityResolver).

Key functions of the Identity Resolver Service include:

- Registering links of created credentials using the primary identifier of the product as the key.
- Enabling downstream value chain actors to discover more information about products they have purchased or are considering purchasing.
- Facilitating the connection between unique identifiers and more information about the product (e.g. [Digital Product Passports](https://uncefact.github.io/spec-untp/docs/specification/DigitalProductPassport), [Traceability Events](https://uncefact.github.io/spec-untp/docs/specification/DigitalTraceabilityEvents) and [Conformity Credentials](https://uncefact.github.io/spec-untp/docs/specification/ConformityCredential)).
<!-- TODO: Update to UN IDR service once built -->
For the Mock Apps, we currently recommend and will be using the [GS1 Digital Link Resolver](https://github.com/gs1/GS1_DigitalLink_Resolver_CE).

### Identity Resolver Service Documentation

Please go through the GS1 Digital Link Resolve documentation available [here](https://github.com/gs1/GS1_DigitalLink_Resolver_CE#fast-start) to understand how to set up and use the Identity Resolver Service.

### Requirements

To use the Identity Resolver Service with the mock apps, you will need:

1. The Identity Resolver Service API running.
2. The address of the Identity Resolver Service API (e.g., http://localhost:8080).
3. The API key of the Identity Resolver Service API (if applicable)


Make sure you have the Identity Resolver Service API set up and running, and note its address and API key (if applicable) before proceeding with the mock app configuration.

In the next section, we will explore the mock app configuration file and how to customise it for your specific use case.