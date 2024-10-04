---
sidebar_position: 51
title: QR Code Scanner Dialog Button
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />
## Description

The QRCodeScannerDialogButton component is responsible for rendering a button that allows the user to scan a QR code. The component will return the data that is scanned by the user.

## Example

```json
{
  "name": "QRCodeScannerDialogButton",
  "type": "EntryData",
  "props": {
    "style": { "margin": "40px auto", "paddingTop": "40px", "width": "80%" }
  }
}
```

## Definitions

| Property | Required | Description                                            | Type                                                                    |
| -------- | -------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| name     | Yes      | The name of the component(should be "RenderCheckList") | String                                                                  |
| type     | Yes      | The type of the component (should be "EntryData")      | [ComponentType](/docs/mock-apps/common/component-type)                  |
| props    | Yes      | The properties for the QRCodeScannerDialogButton       | [Props](/docs/mock-apps/components/qr-code-scanner-dialog-button#props) |

### Props

| Property | Required | Description                 | Type   |
| -------- | -------- | --------------------------- | ------ |
| style    | No       | The style for the component | Object |
