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

`schemas`: Contains the schema files for product passports, conformity credentials, and traceability events.\
`templates`: Contains the templates for the log messages include timestamps, log levels, and descriptive messages regarding the test execution and outcomes.

# Installation

```bash
$ yarn install
```

```bash
# Create config file for the test suite
yarn create:config
```

# Usage

```bash
$ yarn test
```
