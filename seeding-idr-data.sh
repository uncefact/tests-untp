#!/bin/sh
# chmod +x this file to make it executable

SERVICE_NAME="Identity Resolver"

# Max number of retries
MAX_RETRIES=3
RETRY_COUNT=0

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

# Execute create identifier request
curl -X POST \
  http://${IDR_SERVICE_HOST}:${IDR_SERVICE_PORT}/api/identifiers \
  -H 'accept: application/json' \
  -H "Authorization: Bearer ${IDR_SERVICE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
  "namespace": "gs1",
  "applicationIdentifiers": [
    {
      "title": "Global Trade Item Number (GTIN)",
      "label": "GTIN",
      "shortcode": "gtin",
      "ai": "01",
      "type": "I",
      "qualifiers": [
        "10",
        "21"
      ],
      "regex": "(\\d{12,14}|\\d{8})"
    },
    {
      "title": "Batch or lot number",
      "label": "BATCH/LOT",
      "shortcode": "lot",
      "ai": "10",
      "type": "Q",
      "regex": "([\\x21-\\x22\\x25-\\x2F\\x30-\\x39\\x41-\\x5A\\x5F\\x61-\\x7A]{0,20})"
    },
    {
      "title": "Serial number",
      "label": "SN",
      "shortcode": "ser",
      "ai": "21",
      "type": "Q",
      "regex": "(.{0,20})"
    }
  ]
}'

printf "\nSeeding ${SERVICE_NAME} service data complete!\n\n"