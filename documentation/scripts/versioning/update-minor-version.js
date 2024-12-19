const path = require('path');
const { readdir, access } = require('fs/promises');
const { execSync } = require('child_process');

// Get versions
const rootPackageJson = path.resolve(__dirname, '../../../package.json');
const fullRepoVersion = require(rootPackageJson).version;

// Extract only MAJOR.MINOR from the version
const repoVersion = fullRepoVersion.split('.').slice(0, 2).join('.');
const versions = require('../../versions.json');

const docVersion = `${repoVersion}.0`;

const getLatestDocVersion = () => {
  return versions[0];
};

const updateDocVersion = async () => {
  try {
    const latestDocVersion = getLatestDocVersion();

    // Compare versions using MAJOR.MINOR only
    const latestDocMajorMinor = latestDocVersion.split('.').slice(0, 2).join('.');
    if (repoVersion !== latestDocMajorMinor) {
      console.log('Current doc version:', latestDocMajorMinor);
      console.log('Repository version:', repoVersion);

      try {
        console.log(`Updating documentation to version ${docVersion}...`);
        execSync(`npm run docusaurus docs:version ${docVersion}`, {
          stdio: 'inherit',
        });
        console.log('Documentation version updated successfully!');
      } catch (error) {
        console.error('Error updating documentation version:', error);
        process.exit(1);
      }
    } else {
      console.log('Documentation is already up to date with repository version');
    }
  } catch (error) {
    console.error('Error in update process:', error);
    process.exit(1);
  }
};

// Execute the update
updateDocVersion();
