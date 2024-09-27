# Mock app

The mock app present how the supply chain interact each other through the traceability events, and how they can issue the product passport and conformity credential using the UNTP schema.

# Installation

## Prerequisites

- Node.js >= v20.12.2
- Yarn >= 1.22.17

## Configuration

Configuration document is in [here](./documents/configure-document.md)

### Dependencies

The mock app depends on the services: [VCKit](https://github.com/uncefact/project-vckit), [storage service](../storage-server/README.md), and [digital link resolver service](https://github.com/gs1/GS1_DigitalLink_Resolver_CE). Remember to start these services and configure them to the configuration file before starting the mock app.

## Install the dependencies and build the project

At the root of the test-untp repository, run the following command to install the dependencies:

```bash
yarn install
```

then build the project by running the following command:

```bash
yarn build
```

## Start server

```bash
yarn start
```
