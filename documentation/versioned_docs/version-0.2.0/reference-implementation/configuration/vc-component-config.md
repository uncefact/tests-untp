---
sidebar_position: 59
title: VC Component Configuration
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The VC Component Configuration object contains the configuration details for the components to use VC services such as verifying a VC, issuing a VC, etc inside the component.

## Definitions

| Property       | Required | Description                                                                                                                  | Type                                                |
| -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| credentialPath | Yes      | The path for the credential in the data. In some case, the credential can be the whole data or just be contained in the data | String                                              |
| vckitAPIUrl    | Yes      | The URL for the vckit API                                                                                                    | String                                              |
| headers        | No       | The headers for the vckit API, example: \{ Authorization: "Bearer test123"\}                                                 | [HTTP Headers](/docs/reference-implementation/common/http-headers) |

## Example

```json
{
  "credentialPath": "/",
  "vckitAPIUrl": "https://vckit-api.com",
  "headers": { "Authorization": "Bearer test" }
}
```

This example shows the credential path is the root of the data, it means the whole data is the credential.

```json
{
  "credentialPath": "/credential",
  "vckitAPIUrl": "https://vckit-api.com",
  "headers": { "Authorization": "Bearer test" }
}
```

This example shows the credential path is `/credential`, it means the credential is inside the data at the path `/credential`.
