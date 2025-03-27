# tests-untp

The UNTP Test Suite is a comprehensive set of tools designed to ensure conformance to the UN Transparency Protocol (UNTP). This repository contains the following key components:

1. Mock Apps: Demonstrating how decentralized applications work within the UNTP ecosystem.
2. Test Suites: Covering three tiers of testing - technical interoperability, semantic interoperability, and graph validation.
3. Documentation Site: Providing detailed information on setup, configuration, and usage.

The Mock Apps are structured into three main packages:

- Components: Contains the UI components.
- Core: Handles rendering and interaction between components and services.
- Services: Contains the business logic.

These tools allow implementers to model value chains, test UNTP functionality in real-world scenarios, and ensure their implementations align with the UNTP specification across various aspects of interoperability and validation.

## Prerequisites

- [Node.js](https://nodejs.org/en/) version 20.12.2
- [yarn](https://yarnpkg.com/) version 1.22.22
- [Docker](https://www.docker.com/get-started) and [Docker Compose](https://docs.docker.com/compose/install/) (for running services)

## Setup

To set up and run the mock app:

1. Install dependencies:

   ```bash
   yarn install
   ```

2. Build the package:

   ```bash
   yarn build
   ```

3. Start the project:
   ```bash
   yarn start
   ```

## Docker Compose Configuration

We provide a Docker Compose configuration to easily set up the required services (Verifiable Credential Service, Storage Service, a database for the VC service) and the documentation site. To start these services:

```bash
docker-compose up -d
```

This will start pre-configured instances of the necessary services and the documentation site. The `app-config.json` mock app config file is pre-configured to work with these Docker services.

> **Note**: Elements within the documentation site like the header logo, hero image, etc, are pre-configured to use default values. If you would like to modify these default values, see the configuration guide [here](documentation/README.md#environment-variables).

### Docker Compose with Seeding Data

If you want to run the Docker Compose along with seeding data, you can use the following command:

```bash
SEEDING=true docker-compose up -d
```

The `SEEDING` environment variable acts as a flag to seed the Identity Resolver and Mock Global GS1 Resolver services with the necessary data.

## Documentation

For detailed information about the configuration, services, and how to use the mock app, please refer to the documentation site.

The documentation site is available at [`http://localhost:3002`](http://localhost:3002) after starting the services with Docker Compose.

If you need to run the documentation site manually:

```bash
cd documentation
yarn install
yarn start
```

Please consult the documentation for comprehensive instructions on setting up and using the mock app, regardless of whether you're using Docker Compose or setting up services manually.

## Seed Data for Identity Resolver and Mock Global GS1 Resolver services

The Identity Resolver and Mock Global GS1 Resolver services require seed data to function correctly. The seed data scripts are provided in the [idr-data.sh](./seeding/idr-data.sh) and [mock-gs1-data.sh](seeding/mock-gs1-data.sh). To seed the data, run the following commands at the root level:

```bash
# Set environment variables
export IDR_SERVICE_HOST=localhost # IDR service host
export IDR_SERVICE_PORT=3000 # IDR service port
export IDR_SERVICE_API_KEY=test123 # IDR service API key
export IDR_SERVICE_DOMAIN=http://localhost:3000 # IDR service domain

export MOCK_GS1_SERVICE_HOST=localhost # Mock GS1 service host
export MOCK_GS1_SERVICE_PORT=3001 # Mock GS1 service port
export MOCK_GS1_SERVICE_API_KEY=test456 # Mock GS1 service API key

# Run seeding scripts
./seeding/idr-data.sh
./seeding/mock-gs1-data.sh
```

## Documentation Versioning

The project uses Docusaurus for documentation management. Documentation versions are managed through a release script and automated pipeline.

### Release Script

#### Generate Version Mapping Documentation

The version mapping documentation is a page on the documentation site, so it needs to generated before releasing a new version of the documentation. Therefore, the versions in the `version.json` file are the upcoming versions for the upcoming release.
The process of generating the version mapping documentation are as follows:

- Read the versions from `version.json` file
- Fetch the dependent versions from the `version.json` file
- Map the versions data to the template
- Append the generated markdown to the `_version-mapping.mdx` file

To generate the version mapping documentation:

```bash
yarn generate-version-mapping
```

#### Creating a New Documentation Version

The `scripts/release-doc.js` script automates the process of creating new documentation versions:

- Reads the documentation version from `version.json`
- Creates Docusaurus version using `docVersion` value from `version.json` file
  To manually create a new documentation version:

```bash
# Run the release script
yarn release:doc
```

## End-to-end testing

We use Cypress for end-to-end testing with Docker Compose to run the services required for testing. The end-to-end tests are located in the `cypress` folder.

### To run the end-to-end tests, follow these steps:

1. From the root directory, launch the services with Docker Compose:

   ```bash
   SEEDING=true docker compose -f docker-compose.e2e.yml up -d --build
   ```

2. Install dependencies:

   ```bash
   cd e2e
   yarn install
   ```

3. Run the end-to-end tests:

   - To run all tests:

   ```bash
   yarn test:run-cypress
   ```

   - To open Cypress Test Runner:

   ```bash
   yarn test:open-cypress
   ```
