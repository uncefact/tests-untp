---
sidebar_position: 6
title: Storage Service
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

The Storage Service plays a vital role in the United Nations Transparency Protocol (UNTP) ecosystem by providing a [secure and efficient](https://uncefact.github.io/spec-untp/docs/specification/DecentralisedAccessControl) way to store credentials and documents.

It offers the following capabilities:
- Storage of credentials created by the Verifiable Credential Service.
- Storage of documents, such as invoices, used to mimic value chain activities.
- Support for storing credentials in plain text or encrypting them while returning the encryption key and hash.

For the Mock Apps, we recommend and will be using the UN's reference implementation located within the [Identity Resolver Service repository](https://github.com/uncefact/project-identity-resolver).

### Setup Options

#### Option 1: Using Docker Compose (Recommended)

If you've chosen to use the Docker Compose setup as described in the [Dependent Services](/docs/mock-apps/dependent-services/) section, the Storage Service is already configured and ready to use. You don't need to perform any additional setup steps.

#### Option 2: Manual Setup

If you're setting up your own instance of the Storage Service, please follow these steps:

### Storage Service Documentation

Please go through the Storage Service documentation available [here](https://github.com/uncefact/project-identity-resolver#project-identity-resolver) to understand how to set up and use the Storage Service.

### Requirements

To use the Storage Service with the mock apps, you will need:

1. The Storage Service API running.
2. The address of the Storage Service (e.g., http://localhost:3334/v1/documents)
3. The API key of the Storage Service API (if applicable)

If you're using the Docker Compose setup, these requirements are already met, and the Storage Service is available at  http://localhost:3334.

If you're setting up your own instance, make sure you have the Storage Service API set up and running, and note its address and API key (if applicable) before proceeding with the mock app configuration.

In the next section, we will explore the Identity Resolver Service and its role in the UNTP ecosystem.