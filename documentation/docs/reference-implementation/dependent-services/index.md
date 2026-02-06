---
sidebar_position: 4
title: Dependent Services
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

This section provides an overview of the dependent services required for the [United Nations Transparency Protocol (UNTP)](https://uncefact.github.io/spec-untp/). Each service plays a crucial role in the UNTP ecosystem, and proper setup is essential for the functioning of the Reference Implementation system.

Ensure all services are configured and running before proceeding with the Reference Implementation configuration.

- [Verifiable Credential Service](./verifiable-credential-service)
- [Storage Service](./storage-service)
- [Identity Resolver Service](./identity-resolution-service)

## Docker Compose Setup

We have created a Docker Compose file in the root directory to simplify the setup process. This Docker Compose file contains the necessary configurations to start pre-configured instances of the Verifiable Credential Service, Storage Service, a database for the VC service, and the documentation site.

To use the Docker Compose setup:

1. Ensure you have [Docker](https://www.docker.com/products/docker-desktop/) and [Docker Compose](https://docs.docker.com/compose/) installed on your system.

2. Navigate to the root directory of the project where the Docker Compose file is located:
   ```
   cd tests-untp
   ```

3. Run the following command to start the services:
   ```
   docker-compose up -d
   ```

   This command will start all the services in detached mode.

4. To stop the services, use:

   ```
   docker-compose down
   ```

Using this Docker Compose setup allows for a quick and easy deployment of the required services, ensuring they are properly configured and ready for use with the Reference Implementation system.

## Service Endpoints

Once the services are up and running, you can access them at the following endpoints:

- [Documentation Site](http://localhost:3002)
- [Verifiable Credential Service](http://localhost:3332)
- [Storage Service](http://localhost:3334)

## Creating an Identifier (did:web)

After setting up the services, you need to create an identifier (did:web) within the Verifiable Credential Service. This step is crucial for the proper functioning of the system.

To learn how to create an identifier, please refer to the [Verifiable Credential Service](./verifiable-credential-service) page.

## Additional Information

For detailed information about each service, please refer to their respective sections:

- [Verifiable Credential Service](./verifiable-credential-service)
- [Storage Service](./storage-service)
- [Identity Resolver Service](./identity-resolution-service)

Note that the Identity Resolver Service is not currently included in the Docker Compose setup. Please refer to the [Identity Resolver Service](./identity-resolution-service) page for more details on its setup and configuration.