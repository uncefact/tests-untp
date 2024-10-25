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
- `traceabilityEvents`: Contains the schema files for the traceability events. This schema defines a Digital Traceability Event as a Verifiable Credential (VC), enabling the tracking and documentation of events such as object, transactions, transformations, aggregations, and associations within a supply chain. It ensures standardized data exchange by encapsulating event details (e.g., time, location, and product identifiers) with context-driven semantics to support traceability and accountability.
- `digitalFacilityRecord`: Contains the schema files for the digital facility record. It holds performance and compliance information about a facility, such as sustainability metrics, standards, and regulatory conformity. It ensures structured data interoperability by referencing identifiers, classifications, and location details while supporting JSON-LD contexts for semantic meaning.

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

- Node.js >= v20.12.2
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

## UNTP Test Suite CLI Tool

This CLI tool is designed to facilitate the management and execution of the UNTP test suite.

### Installation

Navigate to the `untp-test-suite` package folder. Build the `untp-test-suite` package:

```bash
yarn run build
```

Install the UNTP Test Suite CLI Tool:

```bash
npm install -g .
```

Alternatively, you can run the UNTP test suite by typing the following command into the terminal console:

```bash
yarn run untp
```

### **Create Credentials File**

This command generates a `credentials.json` file in the current working directory.

```bash
untp config
```

or

```bash
yarn run untp config
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
yarn run untp test
```

To use a specific configuration file, use the `-c` or `--config` flag followed by the path to the file.

```bash
untp test --config path/to/credentials.json
```

or

```bash
yarn run untp test --config path/to/credentials.json
```

## UNTP Test Suite Library

This repository contains two UNTP Test Suite Library functions for running the UNTP test suite. The `testCredentialsHandler` function is designed to handle testing of multiple credentials against their respective schemas and generates a final report. Depending on the data passed to the function, it will execute corresponding actions. Additionally, the `testCredentialHandler` function is specialized for testing a credential based on a credential schema configuration.

### Installation

Navigate to the `untp-test-suite` package folder. Build the `untp-test-suite` package:

```bash
yarn run build
```

To use these functions in your project locally, follow these steps:

1. Navigate to the `build` folder inside the `untp-test-suite` package folder.
2. Run `npm link` command.

Now, go to your project folder where you want to integrate the UNTP Test Suite. Initialize a `package.json` file using the `npm init` command. After the `package.json` file is generated, add the following line to it, as the library is an ES module:

```json
"type": "module"
```

Then, install the UNTP Test Suite to the `node_modules` directory of your project by using the `npm link untp-test-suite` command. Now you can use the UNTP Test Suite for your project.

### UNTP Test Suite Library with the `credentials.json` file

If you want to run UNTP tests with a configuration file, then create a `credentials.json` file by using the UNTP Test Suite CLI tool. Type the following command in your terminal:

```bash
untp config
```

The `credentials.json` file will be generated in the current directory.

Open the `credentials.json` file and update it with the following structure, including the `type` and `version` fields, along with the `dataPath` field pointing to the file you want to use for running the UNTP test suite:

```json
{
  "type": "aggregationEvent", // Example event schema type
  "version": "v0.0.1", // Example event schema version
  "dataPath": "/path/to/your/data/file", // Example test data path
  "url": "" // If you want to use a remote schema, provide the URL here, the type and version fields will be ignored
}
```

Now, use the `testCredentialsHandler` function in your project and pass the path to the `credentials.json` file as an argument to the function:

```js
const credentialsFilePath = '/path/to/credentials.json';

testCredentialsHandler(credentialsFilePath)
  .then((results) => {
    // Handle the test results here
  })
  .catch((error) => {
    // Handle any errors here
  });
```

### UNTP Test Suite Library with direct credential objects

If you want to run UNTP tests with direct credential objects, then you can using the content inside the `credentials.json` file that you generated before and pass it to `testCredentialsHandler` function as an argument:

```js
testCredentialsHandler({
  credentials: [
    {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '/data/aggregationEvent.json',
      url: '',
    },
    // Add more credentials as needed...
  ],
})
  .then((results) => {
    // Handle the test results here
  })
  .catch((error) => {
    // Handle any errors here
  });
```

### UNTP Test Suite Library with a credential object

You can run the UNTP test with a credentials object, where the first argument is the credential schema and the second is a test data object.

With local schema:

```js
testCredentialHandler(
  {
    type: 'aggregationEvent',
    version: 'v0.0.1',
  },
  {
    exampleField: 'example data',
    // Add more fields as needed...
  },
)
  .then((results) => {
    // Handle the test results here
  })
  .catch((error) => {
    // Handle any errors here
  });
```

With remote schema:

```js
testCredentialHandler(
  {
    type: '',
    version: '',
    url: 'https://jargon.sh/user/unece/traceabilityEvents/v/working/artefacts/jsonSchemas/render.json?class=AggregationEvent',
  },
  {
    exampleField: 'example data',
    // Add more fields as needed...
  },
)
  .then((results) => {
    // Handle the test results here
  })
  .catch((error) => {
    // Handle any errors here
  });
```

## Integration test

The integration test is used to test the UNTP Test Suite's interface, such as cli and library.

```bash
yarn run test:integration
```

### How to write test cases for the integration test?

1. Create a new folder in the `integration` directory that features the name of the test suite's interface (e.g., cli, library).
2. Create a new file in the folder and name it as `featureA.integration.test.ts`.
3. Write the integration test in the file.
