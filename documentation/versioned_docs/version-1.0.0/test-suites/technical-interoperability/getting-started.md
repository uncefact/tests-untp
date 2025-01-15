---
sidebar_position: 2
title: Getting Started
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

The Getting Started section covers the following topics for technical interoperability testing:

1. **Installation**: Learn how to set up the necessary environment for technical interoperability testing. This includes installing required software, setting up test environments, and preparing your system for running the various test suites.

2. **Configuration**: Understand how to configure the different components of the technical interoperability test suite. We'll cover:

   - Setting up the W3C V2 VCDM test suite for Verifiable Credentials
   - Configuring UNTP-specific extension tests
   - Preparing for Identity Resolution (IDR) testing
   - Setting up storage service testing
   - Configuring transparency graph validation tests

   **Note**: The preset configuration in the config file (`packages/vc-test-suite/config.ts`) has already been preconfigured to use the services set up with Docker Compose. If you're using the default Docker setup, you may not need to modify these settings.

   **Note**: In the config file, you can specify headers to be included in the request for each test suite within the Tier 1 test suite (e.g. `RenderTemplate2024`, `Storage`, etc.). Each test case will inherit these headers from the respective config. This is particularly useful if you need to include an authorization token, such as `Bearer <token>`.

3. **Usage**: Learn how to run the various components of the technical interoperability test suite and interpret the results. This section will guide you through:
   - Running the W3C V2 VCDM tests
   - Executing UNTP extension tests
   - Performing IDR compliance checks
   - Conducting storage and data retrieval tests
   - Validating transparency graphs

By the end of this section, you will have a solid foundation for installing, configuring, and using the UNTP Technical Interoperability Test Suite. You'll be able to validate your UNTP implementation's technical components against the required standards.

If you're using the default Docker setup, most of the configuration has been done for you. However, if you need to customise any settings or are using a different setup, the configuration section of each component will guide you through the necessary steps.
