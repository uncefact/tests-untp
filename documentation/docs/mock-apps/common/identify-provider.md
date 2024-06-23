---
sidebar_position: 34
title: Identify Provider
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description
The `Identify Provider` object is a key component in the Mock App system that links scanned identifiers to their corresponding [Identity Resolver Service](/docs/mock-apps/dependent-services/identity-resolution-service), understands how to communicate with such services and encapsulates logic to interpret data retrieved from data carriers. 

It serves three main functions:

1. Interprets data from scanned carriers
2. Communicates with external identity registrar services
3. Processes identifiers from identity registrars

For instance, when dealing with a Global Trade Item Number (GTIN) from GS1:

1. The GS1 Identify Provider recognises the identifier format
2. It interacts with the Mock Verified By GS1 Service
3. It formats the request appropriately
4. It extracts the actor's Identity Resolver (IDR) link from the response

The Mock App system can use multiple identify providers, each tailored to a specific identity registrar and service. This modular approach allows the system to work with a variety of identification standards and services.

## Example
```json
{
  "identifyProvider": {
    "type": "gs1",
    "url": "http://localhost:3333/products"
  }
}
```

## Definitions

| Property | Required | Description | Type |
|----------|:--------:|-------------|------|
| type | Yes | The type of identify provider, e.g., "gs1" for GS1 standards. | [ProviderType](/docs/mock-apps/common/identify-provider#provider-types) |
| url | Yes | The URL endpoint for the identify provider service. | String |


## Provider Types

| Type | Description |
|------|-------------|
| gs1 | Used for resolving (using the Mock Verified By GS1 Service)/understanding GS1-based identifiers (e.g., GTINs). |

**Note**: The available types may be extended in the future to support additional identity providers.