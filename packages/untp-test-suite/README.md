# untp-test-suite

This directory contains the source code for the test suite that is used to test the application following the configuration defined in the `schemas` and `config` directories.

# Structure

`config`: Contains the configuration credential type for the test suite.\
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

```bash
$ yarn install
```

## Note: Please make sure to build the project before running the test suite.

```bash
yarn run build

# Create config file for the test suite
yarn create:config
```

# Usage

```bash
$ yarn test
```
