---
sidebar_position: 51
title: Import Button
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />
## Description

The ImportButton component is responsible for rendering a button that allows the user to import data. The component will return the data that is imported by the user.

## Example

```json
{
  "name": "ImportButton",
  "type": "EntryData",
  "props": {
    "label": "Import JSON",
    "style": { "margin": "40px auto", "paddingTop": "40px", "width": "80%" }
  }
}
```

## Definitions

| Property | Required | Description                                            | Type                                                    |
| -------- | -------- | ------------------------------------------------------ | ------------------------------------------------------- |
| name     | Yes      | The name of the component(should be "RenderCheckList") | String                                                  |
| type     | Yes      | The type of the component (should be "EntryData")      | [ComponentType](/docs/mock-apps/common/component-type)  |
| props    | Yes      | The properties for the ImportButton                    | [Props](/docs/mock-apps/components/import-button#props) |

### Props

| Property | Required | Description                     | Type   |
| -------- | -------- | ------------------------------- | ------ |
| label    | Yes      | The label for the import button | String |
| style    | No       | The style for the component     | Object |
