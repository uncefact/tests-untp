---
sidebar_position: 39
title: Default Verification Service Link
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `DefaultVerificationServiceLink` object defines the default link and parameters of the verification service used when verifying credentials within the [verify page](/docs/mock-apps/verify-app) of the Mock App system.

The typical flow is as follows:
1. A user runs through the [scanning app](/docs/mock-apps/scanning-app) flow.
2. The resulting credential is passed to the [verify page](/docs/mock-apps/verify-app) of the Mock App system.
3. The [verify page](/docs/mock-apps/verify-app) uses the verification service defined in the `Default Verification Service Link` object to verify the credential.

This object ensures that the Mock App system has a consistent and predefined method for credential verification.

## Example
```json
{
  "defaultVerificationServiceLink": {
    "title": "Default Verification Service",
    "context": "Default Verification Service",
    "type": "application/json",
    "href": "http://localhost:3332/agent/routeVerificationCredential",
    "hreflang": ["en"],
    "apiKey": "test123"
  }
}
```

## Definitions
<!-- Title:  TODO: What is the title used for? -->
<!-- Context: TODO: What is the context used for?  -->
<!-- hrefLang: TODO: Currently not implemented.  -->
<!-- MIME Type: TODO: Currently not implemented. -->

| Property | Required | Description | Type |
|----------|:--------:|-------------|------|
| title | No | The title of the verification service. | String |
| context | No | The context or description of the verification service. | String |
| href | Yes | The URL of the verification service endpoint. | String |
| hreflang | No | An array of language codes that the service supports.| String[] |
| apiKey | Yes | The API key required to access the verification service. | String |
| type | No | The MIME type of the expected response, e.g., "application/json". | String |
