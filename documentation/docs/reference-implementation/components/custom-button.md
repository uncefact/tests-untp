---
sidebar_position: 17
title: Custom Button
---

import Disclaimer from '../../_disclaimer.mdx';

<Disclaimer />

## Description

The CustomButton component renders a button with a loading state and optional download functionality, offering a flexible and reusable solution for various use cases within the application.

This component is used to download data returned by the last service in the services array defined in the application configuration (app-config.json). If the last service does not return any data, the button will not be displayed. For details about the types of services (function types), refer to the `Function Type` section in each service’s documentation.

## Example

```json
{
  "name": "CustomButton",
  "type": "Submit",
  "props": {
    "label": "Submit",
    "description": "Click to submit the form",
    "includeDownload": true,
    "downloadFileName": "result"
  }
}
```

## Definitions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | Yes | The name of the component (should be "CustomButton")| String |
| type | Yes | The type of the button (should be "Submit")| [ComponentType](/docs/reference-implementation/common/component-type) |
| props | Yes | The properties for the CustomButton | [Props](/docs/reference-implementation/components/custom-button#props) |

### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| label | Yes | The text to display on the button | String |
| description | No | Tooltip text for the button | String |
| includeDownload | No | Whether to download the data passed to the button when it is clicked | Boolean |
| downloadFileName | No | The name of the file to download | String |