---
sidebar_position: 5
title: API Pagination
---

# API Pagination

List endpoints return results in pages. A client controls its page with the `limit` (page size) and `offset` (records to skip) query parameters. The library batch-get endpoint uses a separate submitted-id maximum because it accepts an explicit id list rather than a page size.

Both parameters must be digit strings representable as an exact safe integer. A value that is not a whole number, is negative where not allowed, or is too large to represent exactly (above `Number.MAX_SAFE_INTEGER`) is rejected with a `400` naming the requirement, rather than being silently rounded or truncated.

## Maximum page size

The `limit` a client may request is capped at a maximum. A request for more than the maximum is rejected with a `400` response that names the maximum, so the client learns the bound and can adjust its request. This keeps a single request from asking for an unbounded page.

The maximum defaults to `100` and is configurable per deployment through the `API_MAX_PAGE_LIMIT` environment variable.

| Variable              | Description                                                                                                                                                           | Default |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `API_MAX_PAGE_LIMIT`  | Maximum number of records a list endpoint returns per page. A request whose `limit` exceeds this is rejected with a 400 naming the maximum.                           | `100`   |
| `API_MAX_BATCH_LIMIT` | Maximum number of ids accepted by `POST /api/v1/library/batch-get`, counted before duplicate removal. A request above this is rejected with a 400 naming the maximum. | `500`   |

Set either variable to any positive integer to raise or lower its bound for your deployment. A value that is not a positive integer is ignored, the default is applied, and a warning is logged at startup, so a misconfiguration is visible in the logs rather than silently taking effect.

When the configured maximum is below the default page size (`20`), the default page size is lowered to the configured maximum, so a request that omits `limit` still returns no more than the configured maximum.

The batch endpoint validates the request shape before checking `API_MAX_BATCH_LIMIT` and never truncates an over-limit request.

The Compose file supplied with the repository passes `API_MAX_BATCH_LIMIT` through to the reference implementation container from the host environment or from the root `.env` file, so setting it in either reaches the running service. Leaving it unset leaves it unset in the container, and the default applies.

## Where the bound is enforced

The maximum is enforced at runtime, by the API rejecting an over-cap request. The published OpenAPI specification does not carry these values as a `maximum` or `maxItems` constraint on `limit` or `ids`. The API documentation page is generated as static content at build time, so a value embedded in the specification would reflect the build-time default rather than a deployment's configured value, and would mislead a client of a reconfigured deployment. The `400` response is therefore the authoritative statement of the bound for a given deployment, and these levers are documented here, for operators, rather than in the client-facing specification.
