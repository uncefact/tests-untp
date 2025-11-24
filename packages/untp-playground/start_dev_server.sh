#!/bin/bash
set -e
set -x

# Default port if not provided
PORT=${1:-3000}

# Get the directory where the script is located
SCRIPT_DIR=$(dirname "$0")

# Change to the script's directory
cd "$SCRIPT_DIR"

# Define file paths relative to the script's location
PID_FILE="yarn_dev_pid.txt"
LOG_FILE="yarn_dev_output.log"

# Clear previous PID and log files
> "$PID_FILE"
> "$LOG_FILE"

# The 'setsid' command runs the 'yarn dev' process in a new session, detaching it from the terminal to ensure it continues running even if the terminal is closed.
# This also creates a new process group, which allows for a clean and complete shutdown of the server and all its related processes.
# In short, 'setsid' provides a robust way to run the development server as a true background daemon.
setsid yarn dev -p $PORT > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "$PID_FILE"

# Poll the log file until the server is ready
until grep -q "ready on http" "$LOG_FILE"; do
  echo "Waiting for server to start..."
  # Check if the process died unexpectedly
  if ! ps -p $SERVER_PID > /dev/null; then
    echo "Server process died unexpectedly. Check logs:"
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 1
done

echo "Server started on port $PORT!"

# Warm up the main page
echo "Warming up the main page at http://localhost:$PORT..."
curl -s "http://localhost:$PORT/" > /dev/null
echo "Warm-up complete. The server is running."