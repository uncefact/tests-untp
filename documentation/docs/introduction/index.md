---
sidebar_position: 1
title: Introduction
---

import Disclaimer from './../\_disclaimer.mdx';

<Disclaimer />

The UN Transparency Protocol (UNTP) Test Suite is a comprehensive set of tools designed to ensure conformance to the [UNTP Specification](https://uncefact.github.io/spec-untp/). This robust suite enables implementers to thoroughly evaluate their UNTP implementations across various aspects, from technical interoperability to semantic validation.

The Test Suite comprises four primary components:
 - Mock Apps
 - Technical Interoperability
 - Semantic Interoperability
 - Graph Validation

## Mock Apps
[Mock Apps](/docs/mock-apps/) allow implementers to model a value chain using UNTP and integrate their implementation at any point within it. These apps provide a flexible environment for testing and demonstrating UNTP functionality in real-world scenarios.

## Technical Interoperability
This component tests the technical interoperability of implementations based on the UNTP specification. It ensures that the technical aspects of the implementation align with the protocol's requirements.

## Semantic Interoperability
The Semantic Interoperability tests focus on verifying that the credentials produced by an implementation are semantically consistent with the UNTP specification. This allows implementors to be conformant with the core specification while allowing for extensions.

## Graph Validation
This component tests the entire trust graph produced by an implementation against the UNTP specification, ensuring the integrity and validity of the trust relationships within the system.

## Extensibility
It's important to note that the Semantic Interoperability, Graph Validation, and Mock Apps components can be extended to meet the specific needs of industries or value chain actors while still conforming to the core UNTP specification. This flexibility allows for customisation without compromising the protocol's fundamental principles.

## Tiered Approach
The UNTP Test Suite follows a tiered approach, with each tier building upon the previous one:

**Tier 1**: Focuses on technical interoperability.

**Tier 2**: Adds semantic interoperability testing.

**Tier 3**: Incorporates graph validation.

This tiered structure allows implementers to progressively validate their UNTP implementations, ensuring a thorough and systematic approach to conformance testing.

By utilising the UNTP Test Suite and the Mock Apps, implementers can confidently develop, test, and deploy UNTP-compliant systems, fostering greater transparency and trust across global value chains.