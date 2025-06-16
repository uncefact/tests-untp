---
sidebar_position: 57
title: Construct Application Identifier Data
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `constructAiData` object defines the schema for constructing event data for getting Application Identifier (AI) data. It will be used to fetch the AI data from the JSON form or the credential object which are not explicitly defined the data model.

### Example

```json
{
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
```

### Definitions

| Property   | Required | Description                                                                        | Type                                                              |
| ---------- | :------: | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| primary    |   Yes    | The primary AI that defines the AI code and the path for primary AI value          | [AI config](/docs/mock-apps/common/construct-ai-data#ai-config)   |
| qualifiers |    No    | The list of qualifiers that define the AI code and the path for qualifier AI value | [AI config](/docs/mock-apps/common/construct-ai-data#ai-config)[] |

#### AI config

| Property | Required | Description                                                             | Type   |
| -------- | :------: | ----------------------------------------------------------------------- | ------ |
| ai       |   Yes    | The AI code that defines the AI data                                    | String |
| path     |   Yes    | The JSON pointer path to extract the AI data from the credential object | String |
