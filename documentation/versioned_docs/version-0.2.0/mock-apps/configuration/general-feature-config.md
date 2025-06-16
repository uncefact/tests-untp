---
sidebar_position: 10
title: General Feature
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

General Features define a shared set of functionalities accessible by all Mock Apps within the Mock App system.

The Mock App system can include multiple General Features, each containing various features that perform distinct functions. Each General Feature is housed on a single page within the Mock App system, accessible via the sidebar menu.

Implementers can customise each General Feature page with branding elements, such as logos, colours and a title.

Each General Feature comprises a collection of features that encapsulate specific functionality or business logic. These features are made up of configurable components and services.

For instance, a General Feature might involve [requesting a Conformity Credential from an external conformity assessment body (CAB)](/docs/mock-apps/conformity-credential#request-conformity-credential-from-external-service). This is a common process that each app associated with an actor in the value chain would most likely need to perform.

## Diagram 
``` mermaid
graph TD
    A[General Feature]
    A --> B[Name]
    A --> C[Type]
    A --> D[Styles]
    A --> E[Features]
    
    E --> E1[Feature 1]
    E --> E2[Feature 2]

    E1 --> F[Components]
    E1 --> G[Services]

    F --> F1[Component 1] 
    F --> F2[Component 2]

    G --> G1[Service 1]
    G --> G2[Service 2] 
```

## Config
<!-- TODO: Find out what the type is used for -->
| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | Yes | The name of the general feature (displayed in the sidebar)| String |
| type | No | The type of the general feature | String |
| style | Yes | Custom styling options for the general feature (Used to determine the colour of the header and buttons on the general feature page)| [Style](/docs/mock-apps/common/style) |
| features | Yes | A collection of features that make up this general feature | [Feature](/docs/mock-apps/configuration/feature-config)[] |

## Example
<!-- TODO: Update with CC request feature -->
``` json
{
    "name": "CAB 1",
    "type": "",
    "styles": {
        "primaryColor": "rgb(255, 207, 7)",
        "secondaryColor": "black",
        "tertiaryColor": "black"
    },
    "features": []
}

```