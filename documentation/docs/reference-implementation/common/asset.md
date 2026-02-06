---
sidebar_position: 28
title: Asset
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description
The `Asset` object contains information about the brand's visual identity and verification credentials.

## Example

```json
{
  "logo": "https://storage.googleapis.com/acrs-assets/logos/Top-Line-Steel-Logo.jpg",
  "brandTitle": "Top Line Steel",
}
```

## Definitions
<!-- TODO: Find out if brandTitle, passportVC and transactionEventVC is actually being used in the system-->

| Property | Required | Description | Type |
|----------|:--------:|-------------|------|
| logo | Yes | The URL of the brand's logo image. (Displayed in the header and sidebar)| String |
| brandTitle | Yes | The title or name of the brand. | String |