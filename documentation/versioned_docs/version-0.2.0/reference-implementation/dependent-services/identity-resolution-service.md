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
  For the Reference implementations, we currently recommend and will be using the [Pyx Identity Resolver v0.0.1](https://github.com/pyx-industries/pyx-identity-resolver/tree/v0.0.1).

### Identity Resolver Service Documentation

Please go through the Pyx Identity Resolver documentation available [here](https://github.com/pyx-industries/pyx-identity-resolver/blob/v0.0.1/app/README.md) to understand how to set up and use the Identity Resolver Service.

### Overview of Link Resolution Services

The app uses two instances of the Identity Resolver (IDR) service:

1. #### Mock GS1 Service:

   This instance is only used by the app’s scanning feature. It simulates a GS1 resolver, providing initial information for barcodes with primary identifiers (e.g., GTIN), including qualifiers, and returns a linkset with a URL to the primary IDR.

2. #### Primary IDR Service:
   This main resolver is used across the app and stores all sample identifiers and link resolvers. It supports standalone operations and works alongside the mock GS1 service in the scanning feature. The primary IDR also allows the app to register new link resolvers, such as those needed for Traceability Events.

### Development Flexibility

The IDR service enables:

1. Pre-configured testing identifiers and link-resolvers: Simplifies setup in development.
2. Seamless containerized deployment: Ensures consistent behaviour across environments.

### Requirements

To use the Identity Resolver Service with the reference implementations, you will need:

1. The Identity Resolver Service API running.
2. The address of the Identity Resolver Service API (e.g., http://localhost:8080).
3. The API key of the Identity Resolver Service API (if applicable)

Make sure you have the Identity Resolver Service API set up and running, and note its address and API key (if applicable) before proceeding with the reference implementation configuration.

### Seed Script

The seed script is essential for initialising the Identity Resolver (IDR) services by loading pre-configured identifiers and link-resolvers. These identifiers allow the app to register link-resolvers with the correct mapping, ensuring it functions as expected.

#### Script Overview

The script:

1. **Checks the health status** of the IDR service to confirm it's ready to accept requests.
2. **Attempts multiple retries** to accommodate any startup delays.
3. **Seeds data** to the IDR service using identifiers and link-resolvers stored in the `/seeding` folder in the root directory.

#### Prerequisites

The seed script can be run in two ways: directly from the host machine (using `export` to set environment variables) or inside a Docker container (`docker-compose` with environment variables specified under the `seeding-data` service).

#### Option 1: Running the Seed Script Locally

If you are running the seed script directly on your host machine, set the necessary environment variables by exporting them in your shell:

```bash
# Identity Resolver (IDR) Service Configuration
export IDR_SERVICE_HOST=localhost # IDR service host
export IDR_SERVICE_API_VERSION=1.0.0 # IDR API version
export IDR_SERVICE_PORT=3000 # IDR service port
export IDR_SERVICE_API_KEY=test123 # IDR service API key
export IDR_SERVICE_DOMAIN=http://localhost:3000 # IDR service domain

# Mock GS1 Service Configuration
export MOCK_GS1_SERVICE_HOST=localhost # Mock GS1 service host
export MOCK_GS1_SERVICE_API_VERSION=1.0.0 # Mock GS1 service API version
export MOCK_GS1_SERVICE_PORT=3001 # Mock GS1 service port
export MOCK_GS1_SERVICE_API_KEY=test456 # Mock GS1 service API key
```

After setting these variables, run the seed scripts:

```bash
# Run the IDR service seeding script
./seeding-idr-data.sh

# Run the mock GS1 service seeding script
./seeding-mock-gs1-data.sh
```

#### Option 2: Running the Seed Script in Docker Compose

If you’re running the script as part of a Docker Compose setup, specify the environment variables under the seeding-data service. This example assumes the following docker-compose.yml setup:

```bash
services:
  seeding-data:
    image: alpine:3.20.3
    environment:
      # IDR service environment variables
      - IDR_SERVICE_HOST=identity-resolver-service
      - IDR_SERVICE_API_VERSION=1.0.0
      - IDR_SERVICE_PORT=3000
      - IDR_SERVICE_API_KEY=test123
      - IDR_SERVICE_DOMAIN=http://localhost:3000

      # Mock GS1 service environment variables
      - MOCK_GS1_SERVICE_HOST=mock-global-gs1-resolver
      - MOCK_GS1_SERVICE_API_VERSION=1.0.0
      - MOCK_GS1_SERVICE_PORT=3001
      - MOCK_GS1_SERVICE_API_KEY=test456
```

Once this configuration is in place, start the container to automatically run the seed scripts with the environment variables already configured:

```bash
SEEDING=true docker-compose up -d
```

In the next section, we will explore the reference implementation configuration file and how to customise it for your specific use case.
