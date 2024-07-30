---
sidebar_position: 33
title: Credential
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `Credential` object defines the structure and properties of the compliant [Verifiable Credential](https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials), including its context, rendering template, and associated metadata.

## Definition
<!-- TODO: Document the list of dlrIdentificationKeyTypes -->
| Property | Required | Description | Type |
|----------|----------|-------------|------|
| context | Yes | JSON-LD context for the Verifiable Credential | String[] |
| renderTemplate | No | Templates for rendering the Verifiable Credential | [RenderTemplate](/docs/mock-apps/common/render-template)[] |
| type | Yes | Types of the Verifiable Credential | String[] |
| dlrLinkTitle | Yes | Title for the Identity Register link | String |
| dlrIdentificationKeyType | Yes | Type of identification key for IDR. E.g. gtin | [IdentificationKeyType](#) |
| dlrVerificationPage | Yes | URL of the verification page used to verify and render the credential | String |