---
sidebar_position: 8
title: Configuration
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

The Mock Apps config file is used to define the system level config, the apps within the mock app system, the apps functions and the connection to the external services.

## Mock App Configuration File Lifecycle

The Mock App system can be tailored to model different value chains using a configuration file. This section explains the lifecycle of this configuration file and how to apply changes.

### Location of the Configuration File

The configuration file is named `app-config.json` and is located in the root directory of the cloned Mock App repository. To navigate to this directory, use the following command:

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