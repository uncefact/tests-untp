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

The UNTP [test suite](../test-suites) is being refactored. It will be distributed as a Node.js library and a command-line interface, with significant improvements to the testing infrastructure planned across subsequent releases.

## Extensibility

The Test Suites and Reference Implementation can be extended to meet the specific needs of industries or value chain actors while still conforming to the core UNTP specification. This flexibility allows for customisation without compromising the protocol's fundamental principles.
