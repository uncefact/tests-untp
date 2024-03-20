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

---

## UNTP Test Suite CLI Tool

This CLI tool is designed to facilitate the management and execution of the UNTP test suite.

### Installation

Navigate to the `untp-test-suite` package folder. Type the following command into the terminal to install the UNTP Test Suite CLI Tool:

  ```bash
  npm install -g .
  ```

Alternatively, you can run the UNTP test suite by typing the following command into the terminal console:

  ```bash
  npm run untp
  ```

### **Create Credentials File**

  This command generates a `credentials.json` file in the current working directory.

  ```bash
  untp config
  ```

  or

  ```bash
  npm run untp config
  ```

  The `credentials.json` file contains configurations for running the test suite, including types and versions of events and their data paths.

---

### Running UNTP Test Suite

  This command executes the UNTP test suite using the default `credentials.json` file in the current working directory.

  ```bash
  untp test
  ```

  or

  ```bash
  npm run untp test
  ```

To use a specific configuration file, use the `-c` or `--config` flag followed by the path to the file.

  ```bash
  untp test --config path/to/credentials.json
  ```

  or

  ```bash
  npm run untp test --config path/to/credentials.json
  ```