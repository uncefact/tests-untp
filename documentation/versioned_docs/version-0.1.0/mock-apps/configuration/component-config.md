---
sidebar_position: 13
title: Component
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

Components are reusable UI elements that make up the visual and interactive parts of a feature. Some components encapsulate additional logic other than just UI functionalities, like downloading credentials and storing credentials to local storage.

## Diagram

``` mermaid
graph TD
    A[Component]
    A --> B[Name]
    A --> C[Type]
    A --> D[Props]
```

## Config

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | Yes | The name of the component (depends on component used)| [Component](/docs/mock-apps/components/) |
| type | Yes | The type of the component (depends on component used) | [ComponentType](/docs/mock-apps/common/component-type) |
| props | Yes | Properties passed to the component (depends on component used)| [Component](/docs/mock-apps/components/) |

## Example

```json
{
    "name": "CustomButton",
    "type": "Submit",
    "props": {}
}
```