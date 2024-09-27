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

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| vckitAPIUrl | Yes | URL for the VCKit API | String |
| issuer | Yes | Issuer identifier for the Verifiable Credential | String |