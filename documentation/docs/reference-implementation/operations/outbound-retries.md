---
sidebar_position: 13
title: Outbound request retries
---

# Outbound request retries

Every request the Reference Implementation sends to VCKit, the storage service and the identity resolver, and every read of its own stored credential copies, goes through one HTTP client. When a dependency, or a gateway in front of it, refuses a request for a moment, the client waits and sends the request again before the caller sees a failure.

## A 429 is treated as a request that was not processed

The client resends a request answered `429 Too Many Requests` for every kind of call, including calls that create something: credential issuance, document storage, link registration and DID creation. It does so on the understanding that a `429` means the dependency, or the gateway in front of it, refused the request before acting on it. [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585#section-4) defines `429` as rate limiting and does not itself say the request was not acted on, and nothing in this repository can show that every gateway refuses before forwarding.

If a gateway answers `429` after forwarding a request that the dependency did act on, the resend has these effects:

- **Credential issuance through VCKit.** A second credential is signed on the same status-list coordinates. No new status index is allocated, because the index was minted before the issue request.
- **Status changes.** A status change is never resent; see [Calls made while a status list is locked](#calls-made-while-a-status-list-is-locked). A change refused with `429` is reported as not applied and its reservation is cleared. If a forwarding gateway had in fact passed the change on, the provider holds the new bit value with no recorded intent, so no reconcile will pick it up. This was already the case for a single `429` before retries existed.
- **DID creation.** VCKit answers the repeat with "already exists", which the Reference Implementation reports as a DID conflict.
- **Document storage.** The repeat carries the same object id the first request chose. How the storage service treats a second store with that id is not stated in this repository.
- **Link registration with the identity resolver.** If the first request had been applied, the resolver may refuse the repeat as a duplicate, which the Reference Implementation reports as `IDR_PUBLISH_FAILED`.
- **Scheme registration with the identity resolver.** How the identity resolver treats a repeated scheme registration is not stated in this repository.
- **Updates and deletions** (link update and delete, DID delete, storage delete). What a dependency answers to a repeated delete differs from what the Reference Implementation then returns or reports:
  - The identity resolver adapter reports a `404` or `410` on a link delete as a missing link. The link delete route treats that link as already absent, removes its local record and returns `204`.
  - The DID delete route removes its database row before it asks VCKit to delete the DID. If VCKit refuses the repeat, the route logs a warning that the DID may be orphaned and still returns `204`.
  - Removing a stored credential copy, when a credential or library record is deleted or a re-verified copy replaces an older one, reports `storage_delete_failed` as that cleanup's outcome if the storage service answers with an error. The deletion the user asked for can succeed while its cleanup reports this failure.
  - How VCKit and the storage service answer a repeated delete is not stated in this repository.
- **Time added to a single issuance.** The VCKit issue call is retried within the 30 second signing deadline. Storing the credential and registering its links run without a caller deadline after the credential is signed. A refusing gateway can add up to 30 seconds to each of these on `POST /api/v1/credentials`.

If a gateway in your deployment can answer `429` for a request it has forwarded, treat these as possible outcomes and check for them after a burst of refusals.

## What is retried

| Outcome                                                            | Retried for                                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `429`                                                              | every call, except the status-list calls below and a batch item's requests before the item dispatches its credential request (see [Batch items](#batch-items)) |
| `503`                                                              | reads and status checks only                                                                                                                                   |
| An attempt that receives no response headers within its time limit | reads and status checks only                                                                                                                                   |
| `502`, `504`, any other status, a connection failure               | never                                                                                                                                                          |

A call is a read when sending it twice cannot add an effect, whatever its HTTP method. The reads are:

- VCKit credential verification and status reads (`routeVerificationCredential`, `checkBitstringStatus`)
- VCKit DID resolution and DID key lookup (`resolveDid`, `didManagerGet`)
- identity resolver link reads, the resolver description and the link type vocabulary
- reads of this deployment's own stored credential copies by the verification worker, the re-verify route and the backfills

Credential issuance, status-list minting, status changes, document storage, link registration, link updates and deletions, scheme registration and DID creation and deletion are never resent after a `503`, a timeout or a connection failure, because the first attempt may already have taken effect.

A connection failure, where the request gets no HTTP answer at all, is not retried for any call, reads included.

Requests to the sign-in provider, to conformity register discovery endpoints and to credential URIs supplied by a caller of the public verification route do not go through this client and are not retried.

## How long the client waits

Each call makes at most four attempts. Before the first resend the client waits a random time up to 0.5 seconds, then up to 1 second, then up to 2 seconds. The randomness spreads out the resends of many callers that were refused at the same moment.

A `Retry-After` header on a `429`, or on a `503` from a read, is honoured as a floor: the client never resends sooner than the server asked, and adds the random wait on top. It accepts a number of seconds and the three HTTP date forms. `Retry-After: 0` or a date already past means only the random wait. A `Retry-After` the client cannot read, such as `soon`, a date in a time zone other than GMT or a date that does not exist, ends the retry: the caller gets the refusal on that attempt rather than a resend the server may not have wanted. A `Retry-After` longer than 30 seconds ends the retry the same way.

## When retrying stops

Retrying never outlives the caller. Each call has a retry budget that ends at a deadline: the caller's own when it has one, otherwise 30 seconds after the first attempt. No attempt is sent once the caller has given up. A caller that gives up during a wait gets what preceded the wait: the refused response, whose body the client has already read in full, or the error of the attempt that timed out. A caller that gives up while a resent request is in flight gets that request's abort.

Before each wait, the client reads the refused response's body in full, while the caller can still cancel it and no later than the deadline. The response it holds across the wait is a copy built from those bytes, so a caller that gives up during the wait can still read the whole refusal without the network. The client holds that body in memory and sets no size limit of its own on it; the read is bounded only in time, by the deadline and the caller's signal. If that body cannot be read, because the caller gave up or the connection failed partway, the client does not wait or resend. The caller gets the refusal's status and headers, without `content-encoding` and `content-length`, and reading its body fails with the same error. If the deadline arrives while the body is still arriving, the client stops reading it, closes the connection and does not resend. The caller gets the refusal's status and the same reduced headers, with a body that fails to read, with a `TimeoutError`.

| Caller                                                                                   | Retry budget                                                                                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Status reads on the credential status routes                                             | the status operation budget (`CREDENTIAL_STATUS_OPERATION_BUDGET_MS`); half of it for the read before a status change |
| Verification worker, stored copy read and verifier calls                                 | what is left of the job attempt (`WORKER_JOB_TIMEOUT_SECONDS`)                                                        |
| Re-verify route, stored copy read                                                        | `FETCH_TIMEOUT_MS` (default 10 seconds)                                                                               |
| `backfill:credential-status-entries` and `backfill:credential-details`, stored copy read | 30 seconds for each read                                                                                              |
| `backfill:credential-status-attribution`, evidence reads                                 | 30 seconds for each credential                                                                                        |
| Public verification route (`POST /api/v1/credentials/verify`)                            | the 30 second default                                                                                                 |
| Everything else                                                                          | the 30 second default                                                                                                 |

A fresh status read (`GET /api/v1/credentials/{id}/status?fresh=true`) reads a credential's entries one after another within one status operation budget. With several status purposes, retries on one entry use time the later entries would otherwise have, so a later entry can come back among the read's failures while the dependency is refusing.

No retry is dispatched and no wait ends after the deadline. An attempt already sent is bounded by its per-attempt limit, where it has one, and by the caller's signal, where one is supplied, not by the deadline. The exception is the read of a refusal's body before a wait, which also stops at the deadline. The verification worker passes what is left of the job attempt as both the signal and the deadline of its verifier calls, so verifier retries stop when the job attempt's time runs out. Within that time a verifier call still makes at most four attempts, and no single wait is longer than 30 seconds. The verification job's own job retry runs on top of request retry, so a refusing dependency can see up to four requests for each call on every job attempt.

The public verification route has no deadline of its own, so while VCKit is refusing, each anonymous verification request can make up to four VCKit attempts within the 30 second default. Rate limiting that route is left to the deployment's own infrastructure.

DID key lookup, identity resolver link, description and vocabulary reads, and reads of stored copies also have a 10 second limit on each attempt, counted until the response headers arrive. An attempt that hits it is sent again if the retry budget allows. With `FETCH_TIMEOUT_MS` at its default of 10 seconds, a re-verify read that times out has no time left for a second attempt, although a prompt `429` or `503` can still be retried within it. Credential verification, VCKit status reads and DID resolution have no per-attempt limit, so an attempt is bounded by the caller's signal only where the caller supplies one. Status reads from the status routes and the attribution backfill, and the verification worker's verifier calls, supply one. DID resolution (`resolveDid`, used by DID creation, the DID document route and the seed) and the public verification route (`POST /api/v1/credentials/verify`) supply neither a signal nor a per-attempt limit, so the client does not bound an attempt they have sent, apart from reading a refusal's body before a wait, which stops at the 30 second default deadline. VCKit fetches remote JSON-LD contexts while it verifies and the status list credential from its URL while it answers a status read, and DID resolution fetches remote `did:web` documents.

## Status checks

A VCKit status check (`checkBitstringStatus`) has no time limit of its own on each attempt, because VCKit fetches the status list credential from its URL while it answers. Each check is bounded by its caller's budget, which gives both the retry deadline and a signal that ends an attempt in flight:

- A fresh status read and a reconcile: one status operation budget (`CREDENTIAL_STATUS_OPERATION_BUDGET_MS`), shared by every entry the operation reads.
- A status change: the read before the change starts no retry wait after the midpoint of the operation budget, but an attempt in flight runs to the end of the budget. The read-back after the set retries to the end of the budget.
- `backfill:credential-status-attribution`: 30 seconds for each credential, shared by its entries.

A slow status check is therefore never ended and resent as a timeout. It runs until VCKit answers or the caller's budget ends, which aborts it.

## Calls made while a status list is locked

Minting a status entry and setting a status bit run while the Reference Implementation holds that status list's lock, so concurrent changes to one list cannot interleave. These two calls make one attempt and never wait, so a refusal cannot hold the lock for the length of a backoff. A status change refused with `429` is reported as not applied and its reservation is cleared, and a mint refused with `429` fails the issuance before the credential is signed. Status reads made before and after a change run outside the lock and are retried as reads. The read before a change stops starting new retry waits at the midpoint of the status operation budget. A read already in flight at the midpoint still runs to the end of the budget. A read still refused at the midpoint fails the change with no set dispatched, and its reservation is cleared.

## Batch items

Inside a batch item, a request made before the item dispatches its credential request makes one attempt. A read with a 10 second limit on each attempt keeps that limit; only the resends are off. A fault before dispatch goes back to the batch job, which retries the whole item through `BATCH_JOB_RETRY_LIMIT` and its backoff settings, and request retries would multiply with it. A request already in flight when the item dispatches keeps its one attempt.

From dispatch on, the item's requests follow the rules above, because the batch job never issues an item again after a fault from that point. The VCKit issue request, the document store and the identity resolver publish are resent after a `429` within their deadlines, and never after a `503`, a timeout or a connection failure. Reads follow the read rules. An issue request that gets through after a `429` settles the item as `ISSUED`. A `429` still refused after the retries on the issue request or the document store fails the issuance, so the item is recorded as `OUTCOME_UNKNOWN`, as is any other fault that escapes the issuance after dispatch. Resolve such items as the [batch issuance runbook](./batch-issuance) describes. A `429` still refused after the retries on the identity resolver publish does not fail the issuance. The item is recorded as `ISSUED` with the `IDR_PUBLISH_FAILED` warning, so the batch can end `COMPLETED` while that credential's links are most likely not registered. While a dependency is refusing, each of those three calls can add up to about 30 seconds to an item.

## Seeing retries in the logs

Each resend logs a warning, "Outbound request refused; retrying after a wait", with the request's origin and path, the method, the attempt number, the cause (`429`, `503` or `timeout`) and the wait in milliseconds. When a refusal is returned without a further attempt, the warning "Outbound request refused; not retried further" gives the reason: `attempts`, `deadline`, `retry-after-too-long`, `retry-after-invalid`, `aborted`, `body-unreadable` (the refusal's body could not be read before the wait), `suppressed` (a request a batch item made before it dispatched its credential request) or `body-not-replayable`. Neither line carries headers, bodies or the query string. The status-list mint and the status set emit neither warning, because they make one attempt.

A run of these warnings against one dependency means it, or its gateway, is refusing requests. A failure the caller reports after them comes from the last refusal's status, headers and body. Where the client had already read that body before a wait, the headers lack `content-encoding` and `content-length`, because the body is already decoded. If the deadline passed while the body was being read, the body fails to read. Either way the operator backfills still list a credential as failed or its evidence as `unavailable` when every attempt was refused.
