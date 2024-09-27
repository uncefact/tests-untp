---
sidebar_position: 40
title: Identify Key Path
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `IdentifierKeyPath` is a property of services that interact with the data issued to get the identifier to be used for the [IDR](/docs/mock-apps/common/idr) registration. It can be a JSON path of the identifier of the data issued or an object that contains the function `concatService` and the `args` to be used to get the identifier.

## Example

```json
{
  "identifierKeyPath": "/eventID"
}
```

or

```json
{
  "identifierKeyPath": {
    "function": "concatService",
    "args": [
      { "type": "text", "value": "(01)" },
      { "type": "path", "value": "/productIdentifier/0/identifierValue" },
      { "type": "text", "value": "(10)" },
      { "type": "path", "value": "/batchIdentifier/0/identifierValue" },
      { "type": "text", "value": "(21)" },
      { "type": "path", "value": "/itemIdentifier/0/identifierValue" }
    ]
  }
}
```

## Definition for object

| Property | Required | Description                                      | Type   |
| -------- | :------: | ------------------------------------------------ | ------ |
| function |   Yes    | The concat function supported                    | String |
| args     |   Yes    | The array of object that can be `text` or `path` | Array  |
