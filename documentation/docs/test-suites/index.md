---
sidebar_position: 1
title: Test Suites
---

import Disclaimer from '../\_disclaimer.mdx';

<Disclaimer />

The UNTP Test Suite comprises three test suites:

1. [**Technical Interoperability**](/docs/test-suites/technical-interoperability): Validates the technical aspects of implementations against UNTP protocol requirements.

2. [**Semantic Interoperability**](/docs/test-suites/semantic-interoperability): Ensures credentials produced by an implementation are semantically consistent with the UNTP protocol, allowing for conformance while permitting extensions.

3. **Graph Validation**: Assesses the entire trust graph produced by an implementation, verifying the integrity and validity of relationships.

The Test Suite follows a tiered approach:

- [**Tier 1**](/docs/test-suites/technical-interoperability): Technical interoperability
- [**Tier 2**](/docs/test-suites/semantic-interoperability): Semantic interoperability
- **Tier 3**: Graph validation

This structure enables progressive validation of UNTP implementations. The Semantic Interoperability and Graph Validation components are extensible, allowing customisation for specific industry needs whilst maintaining core UNTP compliance.
