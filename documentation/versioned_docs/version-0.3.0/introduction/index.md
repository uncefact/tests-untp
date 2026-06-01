---
sidebar_position: 1
title: Introduction
---

import Disclaimer from './../\_disclaimer.mdx';

<Disclaimer />

The [UN Transparency Protocol (UNTP)](https://uncefact.github.io/spec-untp/) Test Suite is a comprehensive set of tools for implementing, testing, and demonstrating the UNTP specification. It provides everything needed to issue UNTP-compliant verifiable credentials, validate them against the specification, and verify conformance across technical and semantic dimensions.

The repository comprises four primary components:

## Reference Implementation

The [Reference Implementation](../reference-implementation/overview) is a multi-tenant application for issuing, storing, and verifying UNTP-compliant verifiable credentials — including Digital Product Passports (DPPs), Digital Conformity Credentials (DCCs), Digital Facility Records (DFRs), and more.

It acts as an **on-ramp** for organisations and implementers to experiment with UNTP before committing to changes in their production systems, and is used to facilitate **pilots and demonstrations** that showcase the value of UNTP at low cost.

The Reference Implementation delegates to several [dependent services](../reference-implementation/system-architecture) for credential signing, storage, and identifier resolution, and supports a pluggable [adapter architecture](../reference-implementation/services/service-architecture) for integrating with different service providers.

## UNTP Playground

The [UNTP Playground](https://test.uncefact.org/untp-playground) is a web application for validating UNTP credentials against the specification. Upload a credential and receive immediate feedback on whether it conforms — useful both as a development aid during implementation and as a demonstration tool.

## Test Suites

The [Test Suites](../test-suites) provide structured conformance testing across multiple dimensions:

### Technical Interoperability

Tests the technical interoperability of implementations based on the UNTP specification, ensuring that the technical aspects — credential formats, data structures, and protocol requirements — align with the specification.

### Semantic Interoperability

The [Semantic Interoperability tests](../test-suites/semantic-interoperability) verify that the credentials produced by an implementation are semantically consistent with the UNTP specification. This allows implementors to be conformant with the core specification while allowing for extensions.

### Graph Validation

Tests the entire trust graph produced by an implementation against the UNTP specification, ensuring the integrity and validity of the trust relationships within the system.

## Extensibility

The Test Suites and Reference Implementation can be extended to meet the specific needs of industries or value chain actors while still conforming to the core UNTP specification. This flexibility allows for customisation without compromising the protocol's fundamental principles.

## Tiered Approach

The Test Suites follow a tiered approach, with each tier building upon the previous one:

- **Tier 1**: Technical interoperability
- [**Tier 2**](../test-suites/semantic-interoperability): Semantic interoperability
- **Tier 3**: Graph validation

This tiered structure allows implementers to progressively validate their UNTP implementations, ensuring a systematic approach to conformance testing.
