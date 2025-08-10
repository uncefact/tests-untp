# tests-untp

The tests-untp repository is a comprehensive suite of tools designed to support those seeking to implement or demonstrate the UNTP specification. The repository includes:
1. **Reference Implementation**: A preconfigured and customisable web application for issuing UNTP-compliant credentials and simulating actors issuing and verifying these credentials within a value chain. It illustrates the types of credentials one would issue, how data is interlinked between credentials, and provides visual representations of issued credentials.
2. **Test Suites**: Covering technical interoperability, semantic interoperability, and graph validation (algorithmic diligence).
3. **Playground**: A web application for testing UNTP credentials, demonstrating conformance, producing reports, and facilitating debugging during development.
4. **Documentation Site**: Comprehensive resources detailing setup, configuration, and usage of the suite of tools.

## Reference Implementatio Architecture Overview

The repository includes a Reference Implementation and scripts for provisioning several dependent services. Understanding the architecture is essential, as the Reference Implementation relies on these services.

### Key Components and Their Roles

* **Reference Implementation**: Acts as an orchestration layer with a UI, consuming APIs from dependent services to issue, store, retrieve, and verify UNTP credentials, such as Digital Product Passports (DPPs). The `app-config.json` file is used to configure the application at build time, determining its setup and the credentials it can issue.

* **Dependent Services**: Essential for Reference Implementation functionality, managed via Docker Compose. These services are primarily pulled from external Docker images, except for the Documentation Site, UNTP Playground, and Seed Scripts, which are built locally. Further details about dependent service repositories are available in the [Dependent Services section](https://uncefact.github.io/tests-untp/docs/mock-apps/dependent-services/#additional-information) of the documentation website.

  * **Verifiable Credential Service (VCkit)**: Manages DIDs and issues, verifies, and revokes Verifiable Credentials.
  * **Storage Service**: Stores UNTP credentials.
  * **Identity Resolver Service (IDR)**: Manages links to data (including UNTP credentials) that are associated with identifiers.
  * **Mock GS1 IDR Service**: Stand-in resolver for GS1.
  * **Database (Postgres)**: Required for VCkit.

* **Additional Functional Apps/Scripts**:

  * **UNTP Playground**: Facilitates testing and debugging UNTP credentials.
  * **Seed Scripts**: Preconfigured scripts used to populate IDR services, ensuring compatibility with the bundled `app-config.json` configuration.

### Dependencies and Flow

Dependent services must run before the Reference Implementation:

* Launch Docker Compose services.
* Install the dependencies, then build and start the Reference Implementation.

Without the dependent services, the Reference Implementation will fail.

## Prerequisites

* [Docker](https://docs.docker.com/get-started/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/).
* Node.js v20.12.2 and Yarn v1.22.22.

> Note
> Use `docker compose` for Docker CLI v2.0+ or `docker-compose` for older versions. Within this documentation, we will use `docker compose`.

We advise using [Node Version Manager (NVM)](https://github.com/nvm-sh/nvm) to manage Node.js and Yarn versions. 

> Note
> If installing NVM, you may need to close and reopen your terminal to ensure the shell recognises the nvm command.

Once NVM is installed and accessible in your terminal, run these commands from the repository’s root directory to set up the required Node.js and Yarn versions:

```bash
nvm install 20.12.2
nvm use 20.12.2
npm install -g yarn@1.22.22
```

> Tip
> Use `node -v` to confirm your node version and `yarn -v` to confirm your yarn version.

## Setup

### 1. Start Dependent Services

Launch Docker Compose services (ensure docker is running):

```bash
SEEDING=true docker compose up -d
```

### 2. Set Up and Start the Reference Implementation

After Docker services are running:

```bash
yarn install
yarn build
yarn start
```

Access the Reference Implementation on [http://localhost:3003](http://localhost:3003)

> Note 
> You only need to run the install command once. Similarly, if you haven’t made any modifications within the `packages` directory, you only need to run the build command once.

> Note 
> If you modify the `app-config.json` file, you must stop and restart the Reference Implementation for the changes to take effect.

## Documentation

The documentation website is included within the Docker Compose setup and is available at [`http://localhost:3002`](http://localhost:3002) after running Docker Compose. This documentation website contains extensive information about this repository’s contents and instructions on configuring the Reference Implementation and test suites. We recommend using v0.2.0 of the documentation which is available within the dropdown in the navbar. For initial setup purposes, this README is sufficient.

A deployed instance of the documentation site is also available [here](https://uncefact.github.io/tests-untp/).

To run the documentation website outside Docker (ensure you have completed the prerequisites section), execute:

```bash
cd documentation
yarn install
yarn start
```

## Data Seeding

For the Reference Implementation configuration (app-config.json) to work out of the box, the IDR services must be seeded with the identifier scheme (GS1), primary and secondary identifiers (GTIN, Batch, and Serial numbers), and identifiers configured within the included app-config.json.

To quickly get you started, we've defined this data in the `/seeding` directory alongside two scripts for the IDR and Mock GS1 IDR services.

These scripts run automatically when Docker Compose starts with the `SEEDING=true` flag (default is false).

The scripts and their data are necessary for the Reference Implementation to function correctly with the bundled `app-config.json`. Without seeding, the Reference Implementation will fail to resolve identifiers, resulting in errors when issuing credentials

If you modify or introduce a different identifier scheme within the app-config.json file (e.g., Australian Business Register (ABR)) or primary identifier (e.g., Australian Business Number (ABN)), you will need to update the seed data accordingly, including identifiers used for barcode scanning (refer to existing mock GS1 seeding data).

If not using Docker Compose or the `SEEDING=true` flag, manually seed the required data for the IDR services by setting environment variables and running seed scripts:

```bash
export IDR_SERVICE_HOST=localhost
export IDR_SERVICE_API_VERSION=1.0.0
export IDR_SERVICE_PORT=3000
export IDR_SERVICE_API_KEY=test123
export IDR_SERVICE_DOMAIN=http://localhost:3000

export MOCK_GS1_SERVICE_HOST=localhost
export MOCK_GS1_SERVICE_API_VERSION=1.0.0
export MOCK_GS1_SERVICE_PORT=3001
export MOCK_GS1_SERVICE_API_KEY=test456

./seeding/idr-data.sh
./seeding/mock-gs1-data.sh
```

> Note
> If you need to reset the data in the IDR services, delete the directories inside the `minio_data` directory and then run the seed scripts.

## UNTP Playground

This repository contains a playground web application used to test the UNTP credentials produce by ones implmentation. It's primary functions are to validate the credentials you have produced conform with the UNTP specification and as a development aid that provides feedback if something is wrong with the credenails you have produced.

The playground is included within the Docker Compose setup and is available at [`http://localhost:4000`](http://localhost:4000) after running Docker Compose.

Simply navigate to the website and upload a JSON file containing a UNTP credential to validate its compliance. A test credential is availabe on the homepage of the playground to get you started.

> Note
> The other test services within this repository are undergoing a refactor. At this point in time, it's advised to use the Playground instead of the other test services. We will update this readme once the other test services become stable.

## End-to-End Testing

We use Cypress for end-to-end (E2E) testing, using a dedicated `app-config.json` (`e2e/cypress/fixtures/app-config.json`) and Docker Compose configuration (`docker-compose.e2e.yml`).

The Docker Compose configuration sets up all required dependent services and builds an instance of the Reference Implementation using the E2E `app-config.json`.

Any changes to the E2E `app-config.json`, seed scripts or Reference Implementation instance may cause E2E tests to fail due to the way in which the configuration (`app-config.json`) determins the contents and functionality of the Reference Implementation.

Before running E2E tests, ensure:

* You've stopped existing containers (`docker compose down`).
* You've stopped any existing Reference Implementation.

### Launch E2E Services

```bash
SEEDING=true docker compose -f docker-compose.e2e.yml up -d --build
```

> Note
> You will need to rebuild the Reference Implementation container if you've modifyed the E2E `app-config.json`.

### Set Up Cypress

Follow these steps to set up and run Cypress tests after completing the [prerequisites](#prerequisites):

1. **Install Dependencies**  
   Navigate to the `e2e` directory and install dependencies:
   ```bash
   cd e2e
   yarn install
   ```

2. **Run Cypress Tests**  
   From the **root directory** of the repository, use one of the following commands:  
   - To execute tests in headless mode:
     ```bash
     yarn test:run-cypress
     ```
   - To open a new window with the interactive Cypress Test Runner:
     ```bash
     yarn test:open-cypress
     ```

3. **Stop Services**  
   From the **root directory**, stop the services to clean up:
   ```bash
   docker compose -f docker-compose.e2e.yml down
   ```
   
> Note
> Avoid mixing E2E and standard Docker Compose setups.

## Other Useful Commands (developers)
```bash
yarn build
yarn test
yarn lint
yarn storybook:components
yarn storybook:mock-app
```

## Release Management

Review the [release management guide](RELEASE_MANAGEMENT_GUIDE.md) and follow the [release guide](RELEASE_GUIDE.md) before preparing for a release.

## Contributions

Please refer to the [contributing documentation](CONTRIBUTING.md).