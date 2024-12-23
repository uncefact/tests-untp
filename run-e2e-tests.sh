#!/bin/bash
# reset data
TARGET_DIR="./minio_data/identity-resolver-service-object-store/data-test/idr-bucket-1/gs1"

if [ -d "$TARGET_DIR" ]; then
  echo "Found folder: $TARGET_DIR"
  echo "Deleting folder..."
  
  # Xóa folder
  rm -rf "$TARGET_DIR"
  
  if [ $? -eq 0 ]; then
    echo "Folder deleted successfully."
  else
    echo "Failed to delete the folder."
    exit 1
  fi
else
  echo "Folder not found: $TARGET_DIR"
fi
# grant permission for script
chmod +x cypress/e2e/issue_workflow_test/DPP/test-untp-dpp-scripts.sh
