---
sidebar_position: 33
title: Local Storage
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The `LocalStorage` object provides configuration for managing local storage within the Mock App system. It specifies how data should be stored and retrieved from the browser's local storage.

## Example

```json
{
    "storageKey": "steel_mill_1_dpps",
    "keyPath": "/itemList/index/name"
}

```

## Definitions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| storageKey | Yes | The key used to store and retrieve data in local storage | String |
| keyPath | Yes | JSON path to the unique identifier within the stored data | String |
