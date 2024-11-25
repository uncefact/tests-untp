---
sidebar_position: 40
title: Identify Key Path
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `IdentifierKeyPath` can be an object or a string that defines the path to extract the identifier data from the [Json Form component](/docs/mock-apps/components/json-form). When the `identifierKeyPath` is a string, it should be a link resolver URL. When the `identifierKeyPath` is an object, it should contain AI codes and JSON pointer paths to extract the appropriate data for identifier generation.

## Example

```json
{
  "identifierKeyPath": "/id" // Example of a link resolver URL: https://example.com/gs1/01/0123456789123/21/123456/10/123456
}
```

or

```json
{
  "identifierKeyPath": {
    "primary": {
      "ai": "01",
      "path": "/registeredId"
    },
    "qualifiers": [
      {
        "ai": "21",
        "path": "/serialNumber"
      },
      {
        "ai": "10",
        "path": "/batchNumber"
      }
    ]
  }
}
```

## Definition

| Property          | Required | Description                             | Type                                                         |
| ----------------- | :------: | --------------------------------------- | ------------------------------------------------------------ |
| identifierKeyPath |   Yes    | The path to extract the identifier data | String or [AIData](/docs/mock-apps/common/construct-ai-data) |
