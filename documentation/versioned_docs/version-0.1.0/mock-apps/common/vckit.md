---
sidebar_position: 30
title: VCkit
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />
<!-- TODO: Add the ability to pass in an API key -->
## Description

The `VCkit` object contains configuration details for the [Verifiable Credential service](/docs/mock-apps/dependent-services/verifiable-credential-service), which is used to issue and manage Verifiable Credentials.

## Definition

| Property    | Required | Description                                                                       | Type                                                |
| ----------- | -------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| vckitAPIUrl | Yes      | URL for the VCKit API                                                             | String                                              |
| issuer      | Yes      | Issuer identifier for the Verifiable Credential                                   | String                                              |
| headers     | No       | Custom headers to be included in the request to the Verifiable Credential service | [HTTP Headers](/docs/mock-apps/common/http-headers) |
| restOfVC    | No       | Contain any additional properties that are a part of the standard VC structure    | [restOfVC](/docs/mock-apps/common/vckit#restofvc)   |

### restOfVC

The `restOfVC` object contains any additional properties that are a part of the standard Verifiable Credential structure.

| Property   | Required | Description                                                      | Type                                              |
| ---------- | -------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| id         | No       | values include UUID and DIDs                                     | String                                            |
| validUntil | No       | representing the date and time the credential ceases to be valid | DateTimeStamp                                     |
| renderMethod     | No       | render template used in VCkit                                    | [renderMethod](/docs/mock-apps/common/vckit#rendermethod) |

### renderMethod

The `renderMethod` object contains the render template used in VCkit.

| Property | Required | Description       | Type   |
| -------- | -------- | ----------------- | ------ |
| template | Yes      | value of template | String |
| type    | Yes      | type of template  | String |
