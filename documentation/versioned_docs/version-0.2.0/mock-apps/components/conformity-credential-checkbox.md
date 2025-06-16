---
sidebar_position: 21
title: Conformity Credential Checkbox
---

import Disclaimer from '../../_disclaimer.mdx';

<Disclaimer />

## Description

The ConformityCredentialCheckbox component renders a group of checkboxes representing available conformity credentials. It allows users to select one or more credentials, which are then passed to a parent component via an onChange callback.

On mount, the component reads the stored conformity credentials from local storage. It then filters the credentials based on the path segment of the current page (the name of the app or general feature in the path). The filtered credentials are displayed as a list of checkboxes.

## Example

```json
{
  "name": "ConformityCredentialCheckbox",
  "type": "EntryData"
}
```

## Definitions

| Property | Required | Description | Type |
|----------|:--------:|-------------|------|
| name | Yes | The name of the component (should be "ConformityCredentialCheckbox") | String |
| type | Yes | The type of the component (should be "EntryData") | [ComponentType](/docs/mock-apps/common/component-type) |