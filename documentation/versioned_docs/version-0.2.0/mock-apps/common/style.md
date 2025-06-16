---
sidebar_position: 29
title: Style
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />
<!-- TODO: Find out why we can't use the names of colours for primary colours -->

## Description
The `Style` object allows for custom styling options for the overall system, individual mock apps and general features.

## Example
```json
{
  "primaryColor": "rgb(255, 207, 7)",
  "secondaryColor": "black",
  "tertiaryColor": "black"
}
```

## Definitions

| Property | Required | Description | Type |
|----------|:--------:|-------------|------|
| primaryColor | No | The main colour used throughout the system, like the header and buttons. | String |
| secondaryColor | No | A complementary colour used for secondary elements or accents. | String |
| tertiaryColor | No | An additional colour used for tertiary elements or further accent purposes. (Text colour) | String |


Colors can be specified using various formats, including RGB values and hex codes.