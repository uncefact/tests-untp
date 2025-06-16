---
sidebar_position: 12
title: Feature
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

Features are the building blocks of functionality within the Mock App system. Each feature is comprised of components and services which are used to compose the business logic and orchestrate services.

Features encapsulate specific functionalities or processes within an app or general feature.

For example, one feature could be issuing a DPP. Where we would compose the required components, like a form and a button and then the services, like a verifiable credential service to issue the credential, storage serve to store the credential and a Identity Resolver service to register a link to the DPP given the identifier of the product.

Another feature could be selling the product, and so on.

## Diagram

``` mermaid
graph TD
    A[Feature]
    A --> B[Name]
    A --> C[ID]
    A --> D[Components]
    A --> E[Services]

    D --> D1[Component 1]
    D --> D2[Component 2]

    E --> E1[Service 1]
    E --> E2[Service 2]
```

## Config
<!-- TODO: What is id used for -->
| Property   | Required | Description                                    | Type   |
| ---------- | -------- | ---------------------------------------------- | ------ |
| name       | Yes      | The name of the feature (Displayed on buttons to access the feature within the respective mock app and used to construct the path to the feature)                       | String |
| id         | Yes      | The id of the feature                          | String |
| components | Yes      | A collection of components used in the feature | [Component](/docs/mock-apps/configuration/component-config)[]  |
| services   | Yes      | A collection of services used in the feature   | [Service](/docs/mock-apps/configuration/service-config)[]  |

## Example

``` json
{
  "name": "Issue DPP",
  "id": "produce_product",
  "components": [],
  "services": []
}
```
