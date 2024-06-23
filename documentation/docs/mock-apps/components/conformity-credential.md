---
sidebar_position: 20
title: Conformity Credential
---

import Disclaimer from '../../_disclaimer.mdx';

<Disclaimer />
<!-- TODO: Add Verify link generator to conformity credential component -->
## Description

The ConformityCredential component allows users to request and manage conformity credentials. It displays a list of available credential requests as buttons and a table of stored credentials. The component handles the process of requesting credentials from a specified API, storing them locally, and displaying them in a table format.

## Example

```json
{
  "name": "ConformityCredential",
  "type": "Void",
  "props": {
    "credentialRequestConfigs": [
      {
        "url": "http://example.com/deforestation-free-assessment",
        "params": {},
        "options": {
          "headers": [],
          "method": "POST"
        },
        "credentialName": "Deforestation Free Assessment",
        "credentialPath": "/body/credential",
        "appOnly": "Farm"
      },
      {
        "url": "http://example.com/ce",
        "params": {},
        "options": {
          "headers": [],
          "method": "GET"
        },
        "credentialName": "CE Marking",
        "credentialPath": "",
        "appOnly": "Farm"
      },
      {
        "url": "http://example.com/conformity",
        "params": {},
        "options": {
          "headers": [],
          "method": "POST"
        },
        "credentialName": "Conformity",
        "appOnly": "Feedlot"
      }
    ],
    "storedCredentialsConfig": {
      "url": "https://storage.example.com",
      "params": {},
      "options": {
        "bucket": "bucket-stored-example"
      },
      "type": "s3"
    }
  }
}
```

## Definitions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | Yes | The name of the component (should be "ConformityCredential") | String |
| type | Yes | The type of the component (should be "Void") | [ComponentType](/docs/mock-apps/common/component-type) |
| props | Yes | The properties for the ConformityCredential | [Props](/docs/mock-apps/components/conformity-credential#props) |

### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| credentialRequestConfigs | Yes | An array of credential request configurations | [CredentialRequestConfig[]](/docs/mock-apps/components/conformity-credential#credentialrequestconfig) |
| storedCredentialsConfig | Yes | Configuration for storing credentials | [Storage](/docs/mock-apps/common/storage)
### CredentialRequestConfig

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| url | Yes | The URL for the credential request | String |
| params | No | Parameters for the request | Object |
| options | Yes | Request options | [RequestOptions](/docs/mock-apps/components/conformity-credential#requestoptions) |
| credentialName | Yes | The name of the credential | String |
| credentialPath | No | The path to extract the credential from the response | String |
| appOnly | Yes | The application context for the credential | String |

### RequestOptions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| headers | No | Headers for the request | Array |
| method | Yes | HTTP method for the request | String |