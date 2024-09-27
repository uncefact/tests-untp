---
sidebar_position: 35
title: Component Type
---

import Disclaimer from '../../_disclaimer.mdx';

<Disclaimer />

## Description

The `type` property in a component configuration specifies the role or purpose of the [component](/docs/mock-apps/configuration/component-config) within the feature. It determines how the component interacts with other parts of the system and what kind of data it handles.

## Usage

The `type` property is a required field in the [component](/docs/mock-apps/configuration/component-config) configuration. It is used in conjunction with the `name` property to define the behavior and rendering of the component.

## Types

### EntryData

Components with the `EntryData` type are responsible for capturing or providing input data. They are typically used for forms, data entry fields, or components that load data from a source.

### Submit

Components with the `Submit` type are used for triggering actions or submitting data. They are often used for buttons that initiate a process or send data to a [service](/docs/mock-apps/services/). 

When a Submit type component is activated, it executes the first element in the [services](/docs/mock-apps/configuration/service-config) array. Components and services can be chained together, allowing each subsequent Submit event to correspond to executing the next element in the services array.

### Result

Components with the `Result` type are used to display or handle the output of a process. They are typically used for showing the results of an action or displaying processed data.

### Void

Components with the `Void` type are self-describing and do not perform any action. They can be used as placeholders or for components that don't need to interact with the system's data flow or service execution.

## Examples

```json
{
  "name": "JsonForm",
  "type": "EntryData",
  "props": {
    "schema": { /* ... */ },
    "onChange": { /* ... */ }
  }
}
```

In this example, the `JsonForm` component is of type `EntryData`, indicating that it's used for data input.

```json
{
  "name": "CustomButton",
  "type": "Submit",
  "props": {
    "label": "Submit",
    "onClick": { /* ... */ }
  }
}
```

Here, the `CustomButton` component is of type `Submit`, indicating that it's used to trigger an action or submit data. When clicked, it will execute the first service in the services array.

```json
{
  "name": "Spacer",
  "type": "Void",
  "props": {
    "height": "20px"
  }
}
```

This example shows a `Void` type component that might be used to add spacing in the UI without interacting with the system's data or services.