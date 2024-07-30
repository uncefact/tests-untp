---
sidebar_position: 32
title: Storage
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `Storage` object is responsible for managing the configuration of the [Storage service](/docs/mock-apps/dependent-services/storage-service) which is used to store and manage Verifiable Credentials within the Mock App system.

## Example

```json
{
  "storage": {
    "url": "https://storage.example.com/v1/documents",
    "params": {
      "bucket": "verifiable-credentials",
      "resultPath": "/uri"
    },
    "options": {
      "method": "POST",
      "headers": {
        "Content-Type": "application/json"
      }
    }
  }
}
```

## Definitions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| url | Yes | URL for the storage service | String |
| params | Yes | Parameters for the storage service | [Params](/docs/mock-apps/common/storage#params) |
| options | Yes | Options for the storage service request | [Options](/docs/mock-apps/common/storage#options) |

### params

The `params` object contains specific parameters for the storage service.

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| bucket | Yes | The name of the storage bucket | String |
| resultPath | Yes | The path where the result (e.g., URI) will be stored in the response | String |

### options

The `options` object defines the HTTP request options for interacting with the storage service.

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| method | Yes | The HTTP method for the request (e.g., POST) | String |
| headers | Yes | The headers to be sent with the request | [Headers](/docs/mock-apps/common/storage#headers) |

### headers

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| Content-Type | Yes | The MIME type of the request body | String |