---
sidebar_position: 17
title: Custom Button
---

import Disclaimer from '../../_disclaimer.mdx';

<Disclaimer />

## Description

The CustomButton component renders a button with loading state and optional download functionality. It provides a flexible and reusable button solution for various use cases within the application.

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
| type | Yes | The type of the button (should be "Submit")| [ComponentType](/docs/mock-apps/common/component-type) |
| props | Yes | The properties for the CustomButton | [Props](/docs/mock-apps/components/custom-button#props) |

### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| label | Yes | The text to display on the button | String |
| description | No | Tooltip text for the button | String |
| includeDownload | No | Whether to download the data passed to the button when it is clicked | Boolean |
| downloadFileName | No | The name of the file to download | String |