---
sidebar_position: 14
title: Container Users and Writable Paths
---

# Container Users and Writable Paths

Each service that the bundled Compose file, `docker-compose.yml`, starts by default runs as the user its image sets. The observability services behind a profile (`otel-agent`, `tempo` and `grafana`) are not in the table. A service that runs as a user other than root can write only to paths that user owns. Most of the time Docker gets this right on its own. It goes wrong when a volume was created by an image that ran as a different user, or when the host maps container users to other host users. The table below lets you check which user needs to own what.

## Who runs as whom

| Service                                  | Image                                                     | Runs as                                                    | Writes                                                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ri`                                     | Built from `packages/reference-implementation/Dockerfile` | `nextjs`, uid 1001, group `nodejs` (gid 1001)              | No volume. Its data is in the `ri-db` database.                                                                                                                                                                                                                       |
| `ri-worker`                              | The same image as `ri`                                    | `nextjs`, uid 1001, group `nodejs` (gid 1001)              | Its heartbeat file, `/tmp/worker-heartbeat`. Its data is in the `ri-db` database.                                                                                                                                                                                     |
| `keycloak`                               | `quay.io/keycloak/keycloak`                               | `keycloak`, uid 1000, group root (gid 0)                   | `/opt/keycloak/data`, the `keycloak-data` volume. The realm import directory is mounted read-only.                                                                                                                                                                    |
| `vckit-api`                              | `ghcr.io/uncefact/project-vckit`                          | root                                                       | No volume. Its data is in the `db` database.                                                                                                                                                                                                                          |
| `db`                                     | `postgres:16-alpine`                                      | Starts as root, then runs PostgreSQL as `postgres`, uid 70 | `/var/lib/postgresql/data`, the `vckit-data` volume.                                                                                                                                                                                                                  |
| `ri-db`                                  | `postgres:17-alpine`                                      | Starts as root, then runs PostgreSQL as `postgres`, uid 70 | `/var/lib/postgresql/data`, the `ri-db-data` volume.                                                                                                                                                                                                                  |
| `storage-service`                        | `ghcr.io/uncefact/project-storage-service`                | `node`, uid 1000, group `node` (gid 1000)                  | `/app/src/uploads`, the `storage_service_data` volume.                                                                                                                                                                                                                |
| `identity-resolver-service`              | `ghcr.io/pyx-industries/pyx-identity-resolver`            | root                                                       | No volume. Its links are in the object store.                                                                                                                                                                                                                         |
| `identity-resolver-service-object-store` | `pgsty/minio`                                             | root                                                       | `/data`, bind-mounted from `./minio_data/identity-resolver-service-object-store` in the checkout.                                                                                                                                                                     |
| `documentation`                          | Built from `documentation/Dockerfile`                     | `node`, uid 1000, group `node` (gid 1000)                  | `/app`, bind-mounted from `./documentation` in the checkout, so that host directory must be writable by uid 1000. A `documentation/.docusaurus` directory left by an earlier image that ran as root must be removed once. `/app/node_modules` is an anonymous volume. |
| `untp-playground`                        | Built from `packages/untp-playground/Dockerfile`          | `nextjs`, uid 1001, group `nodejs` (gid 1001)              | Nothing. The compose file mounts `./packages/untp-playground` at `/untp-playground`, which the image does not read.                                                                                                                                                   |

The users come from each image's published Dockerfile. An image whose Dockerfile sets no `USER` runs as root. The PostgreSQL images start as root so that their entrypoint can give the `postgres` user ownership of the data directory, and then switch to that user. A data volume with the wrong owner is therefore corrected when the container starts. The MinIO image can switch to another user only through settings the bundled file does not set.

Because the object store runs as root, the files it writes under `./minio_data` in the checkout are owned by root on the host.

## The storage service's uploads after an upgrade

Storage service 4.0.2 runs as uid 1000. Earlier versions ran as root, so a `storage_service_data` volume they wrote to is still owned by root, and storing a credential fails until its owner changes. A fresh volume needs no step. The warning under [Start the Stack](../quick-start#start-the-stack) in the quick start gives the steps.

## The worker's heartbeat and a read-only root filesystem

The worker proves it is healthy by writing a heartbeat file under `/tmp`, which the `nextjs` user can write. With a read-only root filesystem, mount a writable directory at `/tmp`, or point `WORKER_HEARTBEAT_PATH` at a writable path. [Running it elsewhere](./worker#running-it-elsewhere) on the worker page describes the health check that reads the file.

## Rootless Docker and user namespace remapping

Rootless Docker, and Docker with `userns-remap` enabled, map each container user to a different user on the host. Uid 1000 in the container is not uid 1000 on the host. Running `chown` on the volume's directory from the host therefore sets an owner the container does not see as uid 1000.

Change a volume's owner from inside a container instead, so the same mapping applies. The command in the quick-start warning does this:

```bash
docker run --rm -v <volume name>:/data alpine chown -R 1000:1000 /data
```

## Kubernetes

A pod mounts a persistent volume with the owner the storage class gives it, which is often root. Give the user each image runs as write access in one of two ways:

- Set `securityContext.fsGroup` on the pod to the image's group, for example `1000` for the storage service. For volume types that support it, Kubernetes then makes the volume group-writable for that group when it mounts it.
- Add an init container that runs as root and changes the owner of the mounted path, for example `chown -R 1000:1000 /app/src/uploads`, before the service starts.

If the pod sets `readOnlyRootFilesystem: true`, mount an `emptyDir` at `/tmp` in the worker, as described above. The [storage service 4.0.2 release notes](https://github.com/uncefact/project-storage-service/blob/v4.0.2/RELEASE_NOTES.md#before-you-deploy-402) cover its own Kubernetes and rootless cases in more detail.
