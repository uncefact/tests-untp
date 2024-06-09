#!/bin/sh

echo "Updating the app-config.json file with environment variables..."

# Replace variables in the app-config.json file with the exported environment variables
envsubst '${CONFORMITY_CREDENTIALS_URL},${CONFORMITY_STORED_CREDENTIALS_URL},${CONFORMITY_STORED_CREDENTIALS_BUCKET},${CONFORMITY_UPLOAD_CREDENTIALS_URL},${CONFORMITY_UPLOAD_CREDENTIALS_BUCKET},${DLR_API_URL},${VCKIT_API_URL},${DLR_API_KEY},${STORAGE_API_URL},${STORAGE_BUCKET},${RESULT_PATH_URI},${VCKIT_ISSUER},${DLR_VERIFICATION_PAGE},${IDENTIFY_PROVIDER_URL}' < /app/app-config.template.json > /app/packages/mock-app/src/constants/app-config.json

echo "The app-config.json file updated."
