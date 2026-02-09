---
sidebar_position: 36
title: Render Template
---

import Disclaimer from '../../_disclaimer.mdx';

<Disclaimer />
<!-- TODO: Update to RenderTemplate2024 -->
## Description

The `Render Template` is a crucial component of the UNTP ecosystem. It defines how the credential data should be visually presented. This template is typically an HTML structure with placeholders for dynamic content [(Handlebars)](https://handlebarsjs.com/), allowing for a standardised yet flexible presentation of product information.

## Example

```json
{
    "template": "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Digital Product Passport</title><style>/* CSS styles */</style></head><body><div class=\"container\"><header><!-- Header content --></header><section class=\"passport\"><!-- Passport content --></section><section class=\"conformity\"><!-- Conformity content --></section><section class=\"composition\"><!-- Composition content --></section><section class=\"traceability\"><!-- Traceability content --></section><section class=\"product\"><!-- Product information content --></section></div></body></html>",
    "@type": "WebRenderingTemplate2022"
}
```

## Definitions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| template | Yes | The HTML template string for rendering the credential | String |
| @type | Yes | The type of rendering template | WebRenderingTemplate2022 |
