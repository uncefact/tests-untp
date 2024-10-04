#!/bin/sh
# chmod +x this file to make it executable

SERVICE_NAME="Mock Global GS1 Resolver"

# Max number of retries
MAX_RETRIES=3
RETRY_COUNT=0

# Path to the JSON data files
IDENTIFIER_FILE="./seeding/mock-gs1-identifier.json"
IDENTIFICATIONS_FILE="./seeding/mock-gs1-link-resolver.json"

# Wait for the service to be available
echo "Waiting for ${SERVICE_NAME} service to be ready..."

# Loop until the health API returns "status": "OK"
while true; do
  # If max retries reached, exit with error
  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "${SERVICE_NAME} service did not become healthy after $MAX_RETRIES attempts. Exiting..."
    exit 1
  fi

  # Make the health check request
  HEALTH_STATUS=$(curl -s http://${MOCK_GS1_SERVICE_HOST}:${MOCK_GS1_SERVICE_PORT}/health-check | grep -o '"status":"OK"')
  if [ "$HEALTH_STATUS" = '"status":"OK"' ]; then
    echo "${SERVICE_NAME} service is healthy!"
    break
  fi

  RETRY_COUNT=$((RETRY_COUNT+1))
  echo "${SERVICE_NAME} service is not healthy yet. Retrying in 5 seconds..."
  sleep 5  # Wait for 5 seconds before checking again
done

echo "${SERVICE_NAME} service is seeding data…"

# Execute create identifier request
curl -X POST \
  http://${MOCK_GS1_SERVICE_HOST}:${MOCK_GS1_SERVICE_PORT}/api/identifiers \
  -H 'accept: application/json' \
  -H "Authorization: Bearer ${MOCK_GS1_SERVICE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d @"$IDENTIFIER_FILE"

printf "\n"

# Execute create link resolver requests
# Loop through JSON file and make curl requests for each identification
jq -c '.[]' "$IDENTIFICATIONS_FILE" | while read -r IDENTIFICATION; do
  curl -X POST \
    "http://${MOCK_GS1_SERVICE_HOST}:${MOCK_GS1_SERVICE_PORT}/api/resolver" \
    -H 'accept: application/json' \
    -H "Authorization: Bearer ${MOCK_GS1_SERVICE_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$IDENTIFICATION"

  printf "\n"
done

printf "\nSeeding ${SERVICE_NAME} service data complete!\n\n"