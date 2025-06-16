---
sidebar_position: 58
title: Payload Type
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `type` property of the `props` object in a [component](/docs/mock-apps/configuration/component-config) configuration defines the kind of data that component is responsible for handling.

## Usage

The `type` property of the `props` object is required for component receiving data such as [import-button](/docs/mock-apps/components/import-button), [qr-code-scanner-dialog-button](/docs/mock-apps/components/qr-code-scanner-dialog-button), etc. The component will use the `type` to determine how to handle the data it receives.

## Types

### JSON

When a component has the `JSON` type, it will suppose receive any JSON object as its payload and will not transform it in any way.

### VerifiableCredential

When a component has the `VerifiableCredential` type, it will suppose receive a [Verifiable Credential](/docs/mock-apps/common/verifiable-credentials) as its payload and will verify the credential before using it.

## Examples

```json
{
  "name": "ImportButton",
  "type": "EntryData",
  "props": {
    "label": "Import JSON",
    "type": "JSON",
    "style": {}
  }
}
```

In this example, the `ImportButton` component is of type `EntryData` and expects any JSON object as its payload.

```json
{
  "name": "ImportButton",
  "type": "EntryData",
  "props": {
    "label": "Import JSON",
    "type": "VerifiableCredential",
    "style": {}
  }
}
```

In this example, the `ImportButton` component is of type `EntryData` and expects a Verifiable Credential as its payload.
