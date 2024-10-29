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

| Property | Required | Description | Type |
| ----------------- | -------- | ---------------------------------------------------------- | ------------------------------------------ |String |
| nestedComponents | Yes | An array of components to be rendered with the loaded data | [Component](/docs/mock-apps/components/)[] |
| checkBoxLabel | Yes | The label for the checkbox list | String |
| style | No | The style for the component | Object |

## Response Data

The data returned by the component will depend on the data type that is imported or scanned by the user. The data will be verified and decoded if it is an enveloped verifiable credential. There are 3 possible cases:

1. If the imported or scanned data type is a `JSON`, the data will be returned without any transformation and have the key as the file name or URL of QRcode.

```json
{
  "data1.json": {
    "foo": "bar" // Imported data
  },
  "data2.json": {
    "foo": "bar" // Imported data
  }
}
```

2. If the imported or scanned data type is a `VerifiableCredential`, the data will be returned as an object with the key as the file name or URL of QRcode. The imported or scanned VC will be verified based on the `vcOptions` provided in the [Import Button](./import-button) or [QR Code Scanner Dialog Button](./qr-code-scanner-dialog-button) component.

```json
{
  "VC1.json": {
    "@context": [], // Imported VC
    "type": ["VerifiableCredential"]
  },
  "VC2.json": {
    "@context": [], // Imported VC
    "type": ["VerifiableCredential"]
  }
}
```

3. If the imported or scanned data type is a `VerifiableCredential` and the VC is an enveloped VC, the data will be returned as an object with the key as the file name or URL of QRcode. The imported or scanned VC will be verified and decoded based on the `vcOptions` provided in the [Import Button](./import-button) or [QR Code Scanner Dialog Button](./qr-code-scanner-dialog-button) component. The decoded VC will return the same level path as the original VC.
   For example, if the original VC was imported as the whole object of the file, the decoded VC will be returned together with the original VC in an object like below:

```json
// imported VC file
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "id": "data:application/vc-ld+jwt,jwt",
  "type": "EnvelopedVerifiableCredential"
}
```

```json
// return data
{
  "VC1.json": {
    "vc": {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      "id": "data:application/vc-ld+jwt,jwt",
      "type": "EnvelopedVerifiableCredential"
    },
    "decodedEnvelopedVC": {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      "type": ["VerifiableCredential"],
      "credentialSubject": {
        "id": "did:example:123",
        "name": "Alice"
      }
    }
  }
}
```

But when imported data has `credentialPath` in `vcOptions`, the decoded VC will be returned with the path specified in `credentialPath` together with the original VC in an object like below:

```json
// vcOptions
{
  "credentialPath": "/vc"
}
```

```json
// imported VC file
{
  "vc": {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    "id": "data:application/vc-ld+jwt,jwt",
    "type": "EnvelopedVerifiableCredential"
  },
  "linkResolver": "https://example.com"
}
```

```json
// return data
{
  "VC1.json": {
    "vc": {
      "vc": {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        "id": "data:application/vc-ld+jwt,jwt",
        "type": "EnvelopedVerifiableCredential"
      },
      "decodedEnvelopedVC": {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        "type": ["VerifiableCredential"],
        "credentialSubject": {
          "id": "did:example:123",
          "name": "Alice"
        }
      }
    },
    "linkResolver": "https://example.com"
  }
}
```
