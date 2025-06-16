---
sidebar_position: 19
title: Local Storage Loader
---

import Disclaimer from '../../_disclaimer.mdx';

<Disclaimer />
<!-- TODO: What pointer is used to access the object returned by LocalStorageLoader within nestedComponents -->
## Description

The LocalStorageLoader component is responsible for loading data from local storage and providing it to nested components. It allows for the retrieval and use of previously stored data within the application.

## Example

```json
{
  "name": "LocalStorageLoader",
  "type": "EntryData",
  "props": {
    "storageKey": "steel_mill_1_dpps",
    "nestedComponents": [
      {
        "name": "JsonForm",
        "type": "EntryData",
        "props": {
          "schema": { /* ... */ },
          "constructData": { /* ... */ }
        }
      }
    ]
  }
}
```

## Definitions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | Yes | The name of the component(should be "LocalStorageLoader")| String |
| type | Yes | The type of the component (should be "EntryData") | [ComponentType](/docs/mock-apps/common/component-type) |
| props | Yes | The properties for the LocalStorageLoader | [Props](/docs/mock-apps/components/local-storage-loader#props) |

### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| storageKey | Yes | The key used to retrieve data from local storage | String |
| nestedComponents | Yes | An array of components to be rendered with the loaded data | [Component](/docs/mock-apps/components/)[] |