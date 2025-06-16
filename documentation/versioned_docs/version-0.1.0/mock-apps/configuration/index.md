---
sidebar_position: 8
title: Configuration
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

The Mock Apps config file is used to define the system level config, the apps within the mock app system, the apps functions and the connection to the external services.

## Example Configuration

The `app-config.json` file in the root directory contains an example configuration for a value chain called "Truffle". This configuration is pre-set to work with the services created by the Docker Compose setup.

### Pre-configured Services

Most of the service endpoints in the example configuration are already set to use the Docker Compose services. The only endpoint you might need to change is the Identity Resolver Service (IDR) endpoint.

- By default, the IDR service endpoint is set to `http://localhost:8080`.
- If you've changed this endpoint, update the `dlr` values in the config file accordingly.

### Updating the Issuer

You will need to update the `issuer` property value (did:web) inside the `vckit` object. This should be set to the identifier you created using the [Verifiable Credential Service](/docs/mock-apps/dependent-services/verifiable-credential-service).

For example:

```json
"vckit": {
  "issuer": "did:web:your-created-identifier"
}
```

## Mock App Configuration File Lifecycle

The Mock App system can be tailored to model different value chains using a configuration file. This section explains the lifecycle of this configuration file and how to apply changes.

### Location of the Configuration File

The configuration file is named `app-config.json` and is located in the root directory of the cloned repository. To navigate to this directory, use the following command:

```bash
cd tests-untp
```

### Modifying the Configuration File

1. Open the `app-config.json` file.
2. Make the necessary modifications to tailor the Mock App system to your desired value chain.
3. Save the changes to the file.

### Applying Configuration Changes

For the modifications to take effect in the Mock Apps, follow these steps:

1. If the Mock App system is currently running, stop it.
2. After saving the changes to `app-config.json`, restart the Mock App system using the following command:

```bash
yarn start
```

### Important Notes

- Changes to the configuration file will not be reflected in the mock apps until you restart the Mock App system.
- Always ensure you save the `app-config.json` file before restarting the Mock App system.
- If you're using the Docker Compose setup, most service endpoints are pre-configured. You only need to update the `issuer` property in the `vckit` object and potentially the IDR service endpoint if you've changed it from the default.