#!/bin/bash

echo "Current working directory: $(pwd)"
# Set variables
SOURCE_FILE="cypress/e2e/issue_workflow_test/DPP/credentials.json"
DEST_FOLDER="packages/untp-test-suite"

# Verify paths
if [ ! -f "$SOURCE_FILE" ]; then
    echo "Source file not found: $SOURCE_FILE"
    exit 1
fi

if [ ! -d "$DEST_FOLDER" ]; then
    echo "Destination folder not found: $DEST_FOLDER"
    exit 1
fi

# Copy the JSON file to the new folder
cp "$SOURCE_FILE" "$DEST_FOLDER" || { echo "Failed to copy $SOURCE_FILE to $DEST_FOLDER"; exit 1; }
# Navigate to the new folder
cd "$DEST_FOLDER" || { echo "Failed to navigate to folder: $DEST_FOLDER"; exit 1; }

# Run yarn build
if ! command -v yarn &> /dev/null; then
    echo "yarn is not installed. Please install it before running the script."
    exit 1
fi

yarn run build || { echo "Build failed"; exit 1; }

# Run npm install globally
if ! command -v npm &> /dev/null; then
    echo "npm is not installed. Please install it before running the script."
    exit 1
fi

npm install -g . || { echo "Global npm install failed"; exit 1; }

# Run untp script
yarn run untp test || { echo "untp script failed"; exit 1; }

echo "Script completed successfully!"
# End of script
