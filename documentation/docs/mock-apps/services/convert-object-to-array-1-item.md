---
sidebar_position: 56
title: Convert Object To Array 1 Item
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

## Description

The `convertObjectToArray1Item` service is responsible for converting an object to an array with one item. This service is used to convert an object to an array with one item to be used in the individual event services like [processObjectEvent](/docs/mock-apps/services/process-object-event), [processAggregationEvent](/docs/mock-apps/services/process-aggregation-event), [processTransformationEventOnly](/docs/mock-apps/services/process-transformation-event-only), [processAssociationEvent](/docs/mock-apps/services/process-association-event), and [processTransactionEvent](/docs/mock-apps/services/process-transaction-event). The service will convert the data that is from the JSON form of the JSON schema with the root type is an object to an array with one item.

## Diagram

```mermaid
flowchart TD
   A[Client] --JSON form radio button select an event--> B[Traceability Event]
   B --An array data--> C[Object Event]
   A --JSON form simple Object event--> D[Convert object data to array 1 item data]
   D --An array of 1 Object event data--> C
```

## Example

```json
{ "name": "convertObjectToArray1Item", "parameters": [{ "path": "/data" }] }
```

## Definitions

| Property | Required | Description | Type |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | |
| path | No | The path of the data wants to convert. If the path is undefined, it will convert the whole data. | [IdentifierKeyPath](/docs/mock-apps/common/identifier-key-path) |
