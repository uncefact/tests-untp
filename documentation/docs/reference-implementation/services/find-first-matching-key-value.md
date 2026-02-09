---
sidebar_position: 57
title: Find First Matching Key Value
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `findFirstMatchingKeyValue` service searches for the first occurrence of a specific key within a deeply nested object and retrieves its corresponding value. If the key is found, the function immediately returns the value. If the key does not exist, the function returns `undefined`.

The function uses a recursive approach to traverse the nested structure. It supports cases where the input data is null, undefined, or empty and ensures the search is performed safely.

## Diagram

```mermaid
flowchart TD
  A[Start] --> B{Is data valid?}
  B -- No --> F[Return undefined]
  B -- Yes --> C[Iterate over keys]
  C --> D{Key matches targetKey?}
  D -- Yes --> E[Return value]
  D -- No --> G{Value is object?}
  G -- No --> C
  G -- Yes --> H[Recursively search nested object]
  H --> C
  C --> F[Return undefined if not found]
```

## Example

```json
{
  "name": "findFirstMatchingKeyValue",
  "parameters": {
    "targetKey": "key"
  }
}
```

## Definitions

| Property | Required | Description | Type |
| -------- | -------- | ----------- | ---- |
| data     | Yes      | The nested object to search through | Object |
| targetKey | Yes     | The key to search for within the nested object | String |

## Function type

| Type       | Description                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| ReturnData | It processes the input data or generates data independently and returns the processed result after successful execution. |
