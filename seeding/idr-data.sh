#!/bin/sh
# chmod +x this file to make it executable

SERVICE_NAME="Identity Resolver"

# Max number of retries
MAX_RETRIES=3
RETRY_COUNT=0

# Path to the IDR identifier JSON file
IDENTIFIER_FILE="./seeding/idr-identifier.json"

# Path to the IDR identifier JSON file for ato namespace
ATO_IDENTIFIER_FILE="./seeding/idr-identifier.ato.json"

# Wait for the service to be available
echo "Waiting for ${SERVICE_NAME} service to be ready..."

# Loop until the health API returns "status": "OK"
while true; do
  # If max retries reached, exit with error
  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "${SERVICE_NAME} service did not become healthy after $MAX_RETRIES attempts. Exiting..."
    exit 1
  fi

  # Make the health check request and store the status
  HEALTH_STATUS=$(curl -s http://${IDR_SERVICE_HOST}:${IDR_SERVICE_PORT}/health-check | grep -o '"status":"OK"')
  if [ "$HEALTH_STATUS" = '"status":"OK"' ]; then
    echo "${SERVICE_NAME} service is healthy!"
    break
  fi

  RETRY_COUNT=$((RETRY_COUNT+1))
  echo "${SERVICE_NAME} service is not healthy yet. Retrying in 5 seconds..."
  sleep 5  # Wait for 5 seconds before checking again
done

echo "${SERVICE_NAME} service is seeding data…"

# Execute create identifier request with JSON data from a file
curl -X POST \
  http://${IDR_SERVICE_HOST}:${IDR_SERVICE_PORT}/api/identifiers \
  -H 'accept: application/json' \
  -H "Authorization: Bearer ${IDR_SERVICE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d @"$IDENTIFIER_FILE"

curl -X POST \
  http://${IDR_SERVICE_HOST}:${IDR_SERVICE_PORT}/api/identifiers \
  -H 'accept: application/json' \
  -H "Authorization: Bearer ${IDR_SERVICE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d @"$ATO_IDENTIFIER_FILE"

printf "\nSeeding ${SERVICE_NAME} service data complete!\n\n"