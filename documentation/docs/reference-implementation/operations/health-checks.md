---
sidebar_position: 13
title: Health Checks
---

# Health Checks

The web process answers two health routes. Neither needs a session or token, in open or closed tenant mode.

- `GET /api/health` is liveness. It answers 200 whenever the process can answer, and it checks nothing else. The image `HEALTHCHECK` probes it.
- `GET /api/health/ready` is readiness. It answers 200 when this instance's database client answers a query within 2 seconds, and 503 when it does not. Use it to decide whether an instance should receive traffic.

## What readiness checks

Readiness runs `SELECT 1` through the Prisma client the API routes use. The result is reported as `database`.

It does not check VCKit, the storage service, the identity resolver, Keycloak, the worker, or the job queue's own connection pool. VCKit, storage, the identity resolver and Keycloak are shared by every instance. Taking one instance out of rotation because of them would not help, and would turn a partial outage into a total one. The job queue reads the same `RI_DATABASE_URL` as the Prisma client, but readiness tests only the Prisma client.

## Response

When the check passes, the route answers 200:

```json
{ "status": "pass", "timestamp": "2026-11-18T09:30:00.000Z", "checks": { "database": { "status": "pass" } } }
```

When it fails, the route answers 503, with both statuses `fail`:

```json
{ "status": "fail", "timestamp": "2026-11-18T09:30:00.000Z", "checks": { "database": { "status": "fail" } } }
```

Both responses carry `Cache-Control: no-store`. The body holds no error text, host, duration or version. The reason for a failure goes to the web process's log as a warning, "Readiness check failed". When checks pass again after a failure, the log gets one info line, "Readiness checks passing again".

`GET` is the supported method. The two routes use different status words on purpose: `/api/health` answers `{"status":"healthy","timestamp":...}`, and readiness answers `pass` or `fail`.

## Timing

The check has 2 seconds to answer. A completed result is reused for 1 second after it completes, so each process runs at most one check a second however often it is probed. The `timestamp` is the time of the response. The observation behind a 200 is at most about 1 second old.

## What a 503 can mean

A 503 means the latest check did not get a successful answer within 2 seconds. The database may be down or unreachable, the Prisma connection pool may have had no free connection, the database may have answered too slowly, or the web process may have been too busy to read the answer in time. A busy instance can therefore read 503. If every instance is saturated at the same time, every instance reads 503, and your load balancer or orchestrator decides whether traffic still reaches them. The body does not say which cause applies.

## What a pass does not mean

A 200 does not mean that writes work, that migrations are current, that a job can be sent, or that every connection pool in the process was tested. Readiness also has no shutdown signal, so it does not switch to 503 while the instance is stopping. On `SIGTERM` the web server stops accepting new connections and lets requests already in progress finish.

## Probing from an orchestrator

:::warning

Keep the image `HEALTHCHECK` and a Kubernetes `livenessProbe` on `/api/health`. A runtime that restarts or replaces an instance whose check fails would otherwise restart every instance during a database outage without repairing it.

:::

A Kubernetes `readinessProbe` for the web container:

```yaml
readinessProbe:
  httpGet:
    path: /api/health/ready
    port: 3003
  timeoutSeconds: 3
```

Kubernetes defaults `timeoutSeconds` to 1 second. With that default, a pass that takes between 1 and 2 seconds reads as a failure. Three seconds is this project's advice, not a Kubernetes requirement.

## A connection that goes silent

A database connection can go silent, for example when the database host has gone. The first probe that starts a fresh check then takes about 2 seconds and returns 503. Later probes return 503 at once.

Once the unanswered query is 10 seconds old, readiness tries one replacement query. If the replacement fails outright, a later probe tries again. If the replacement is also handed a silent connection, the instance stays at 503 until one of the two queries ends or the instance is replaced. Readiness has at most two readiness queries outstanding in that state. The log shows one warning when the first query times out and one when the replacement does, then nothing more while both stay unanswered. If an instance stays at 503 like this, recycle it.

## Docker Compose and alerting

Plain Docker Compose does not restart a container on a failed health check. A Compose override you control may point its own healthcheck at `/api/health/ready` as a signal only. Alerting on a failed probe is left to each deployment.

## The worker

The worker has no HTTP server, so it has no health route. It proves itself with a heartbeat file instead. See the worker's [Health](./worker#health) section.
