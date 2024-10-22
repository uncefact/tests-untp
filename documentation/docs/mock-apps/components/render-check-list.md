---
sidebar_position: 50
title: Render Check List
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />
## Description

The RenderCheckList component is responsible for rendering a list of items with checkboxes. It is a composed component that will load data from another component ([Import Button](./import-button) and [QR Code Scanner Dialog Button](./qr-code-scanner-dialog-button)), when the user clicks to import or scan a QR code. The component will render a list of items with checkboxes, the labels of the checkboxes will be the identifiers of the items that are loaded from the data with the path is configured at `requiredFieldPath` field.

## Example

```json
{
  "name": "RenderCheckList",
  "type": "EntryData",
  "props": {
    "requiredFieldPath": "/vc/credentialSubject/eventID",
    "checkBoxLabel": "Imported valid json:",
    "nestedComponents": [
      {
        "name": "ImportButton",
        "type": "EntryData",
        "props": {
          "label": "Import JSON",
          "style": { "margin": "40px auto", "paddingTop": "40px", "width": "80%" }
        }
      },
      {
        "name": "QRCodeScannerDialogButton",
        "type": "EntryData"
      }
    ],
    "style": { "margin": "40px auto", "paddingTop": "40px", "width": "80%" }
  }
}
```

## Definitions

| Property | Required | Description                                            | Type                                                        |
| -------- | -------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| name     | Yes      | The name of the component(should be "RenderCheckList") | String                                                      |
| type     | Yes      | The type of the component (should be "EntryData")      | [ComponentType](/docs/mock-apps/common/component-type)      |
| props    | Yes      | The properties for the RenderCheckList                 | [Props](/docs/mock-apps/components/render-check-list#props) |

### Props

| Property          | Required | Description                                                | Type                                       |
| ----------------- | -------- | ---------------------------------------------------------- | ------------------------------------------ |
| requiredFieldPath | Yes      | The path for the label of the checkbox item                | String                                     |
| nestedComponents  | Yes      | An array of components to be rendered with the loaded data | [Component](/docs/mock-apps/components/)[] |
| checkBoxLabel     | Yes      | The label for the checkbox list                            | String                                     |
| style             | No       | The style for the component                                | Object                                     |

## Response Data

The component will return an object with data that is selected by the user from the list of checkboxes. The object will have the following structure:

```json
{
  "0123456789": {
    // Imported data
  },
  "9876543210": {
    // Imported data
  }
}
```
