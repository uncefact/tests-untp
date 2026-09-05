#!/bin/sh
# The worker's container health check (#985). The worker publishes
# /tmp/worker-heartbeat each time its own probe succeeds (the queue's pool
# answers and a consumer has fetched recently or holds a job), so a stale
# file means the process is up but not proving it can work. The age limit is
# three of the worker's 10 s intervals. Both sides read WORKER_HEARTBEAT_PATH.
# Every step that can fail is checked, and a future timestamp (a clock that
# stepped back) is not taken as fresh. Exit codes: 0 healthy, 1 unhealthy.
set -u
FILE=${WORKER_HEARTBEAT_PATH:-/tmp/worker-heartbeat}
MAX_AGE=${WORKER_HEARTBEAT_MAX_AGE_SECONDS:-30}
[ -f "$FILE" ] || { echo "no heartbeat file at $FILE"; exit 1; }
now=$(date +%s) || { echo "cannot read the clock"; exit 1; }
mtime=$(stat -c %Y "$FILE") || { echo "cannot stat $FILE"; exit 1; }
case "$now$mtime" in *[!0-9]*) echo "clock or mtime not numeric: now=$now mtime=$mtime"; exit 1;; esac
age=$(( now - mtime ))
[ "$age" -ge 0 ] || { echo "heartbeat is ${age}s in the future; the clock moved"; exit 1; }
[ "$age" -le "$MAX_AGE" ] || { echo "heartbeat is ${age}s old (limit ${MAX_AGE}s)"; exit 1; }
echo "heartbeat ${age}s old"
