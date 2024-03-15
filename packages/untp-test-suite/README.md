# untp-test-suite

The UNTP Test Suite is a tool that allows you to test your credentials against the UNTP schema data models.

# Features

- Test the product passport, conformity credential, and traceability events against the UNTP schema data models.
- Run the test suite using the command line interface (CLI)
- Expose the test suite as a service (Library)

# Structure

`core`: Implements UNTP Test Suite's core functionality, low-level services, and utilities.

- `services`: Contains the services that are used to interact with the application.
- `types`: Contains the types that are used to define the data structure of the application.

`interfaces`: Contains the interfaces that are used to define the output of the application.\

- `api`: Define the output of the application's API.
- `cli`: Define the output of the application's cli.
- `service`: Define the output of the application's service.

`schemas`: Contains the schema files for product passports, conformity credentials, and traceability events.

- `productPassport`: Contains the schema files for the product passport.
- `conformityCredential`: Contains the schema files for the conformity credential.
- `aggregationEvent`: Contains the schema files for the aggregate event (An aggregation event describes that consolidation or de-consolidation of products such as stacking bales of cotton on a pallet for transportation).
- `objectEvent`: Contains the schema files for the object event (An object event describes an action on specific product(s) such as an inspection).
- `transactionEvent`: Contains the schema files for the transaction event (A transaction event describes the exchange of product(s) between two actors such as sale of goods between seller and buyer).
- `transformationEvent`: Contains the schema files for the transformation event (A transformation event describes a manufacturing process that consumes input product(s) to create new output product(s)).

`templates`: Contains the templates for the log messages include timestamps, log levels, and descriptive messages regarding the test execution and outcomes.

# Reference link schema

[Product Passport](https://jargon.sh/user/unece/DigitalProductPassport/v/0.0.1/artefacts/jsonSchemas/render.json?class=ProductPassport)\
[Conformity Credential](https://jargon.sh/user/unece/ConformityCredential/v/working/artefacts/jsonSchemas/render.json?class=ConformityAttestation)

## Traceability event

[Aggregation Event](https://jargon.sh/user/unece/traceabilityEvents/v/working/artefacts/jsonSchemas/render.json?class=AggregationEvent)\
[Object Event](https://jargon.sh/user/unece/traceabilityEvents/v/working/artefacts/jsonSchemas/render.json?class=ObjectEvent)\
[Transaction Event](https://jargon.sh/user/unece/traceabilityEvents/v/working/artefacts/jsonSchemas/render.json?class=TransactionEvent)\
[Transformation Event](https://jargon.sh/user/unece/traceabilityEvents/v/working/artefacts/jsonSchemas/render.json?class=TransformationEvent)

# Installation

## Prerequisites

- Node.js >= v18.17.0
- Yarn >= 1.22.17

## Install the dependencies and build the project

```bash
# Install the dependencies
$ yarn install
```

**Note: Please make sure to build the project before running the test suite.**

```bash
# Build the project
yarn build
```

# Usage

## CLI

Configure the credential configuration by running the following command:

```bash
yarn untp config
```

**Note: After run the configuration command, you need to provide the data path of the product passport, conformity credential, and traceability events to the configuration file.**

Run the test suite by running the following command:

```bash
yarn untp test
```
