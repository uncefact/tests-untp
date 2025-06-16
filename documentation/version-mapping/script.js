const fs = require('fs');
const axios = require('axios');
const path = require('path');
const Handlebars = require('handlebars');

const testUntpRepo = 'https://github.com/uncefact/tests-untp.git';

const loadTemplate = (templateFilePath) => {
  if (!fs.existsSync(templateFilePath)) {
    throw new Error(`Template file not found: ${templateFilePath}`);
  }
  return fs.readFileSync(templateFilePath, 'utf8');
};

const appendToVersionFile = (versionData) => {
  const versionFilePath = path.join(__dirname, '../docs/_version-mapping.mdx');
  const templateFilePath = path.join(__dirname, 'template.hbs');
  try {
    // Load and compile the template
    const templateContent = loadTemplate(templateFilePath);
    const compiledTemplate = Handlebars.compile(templateContent);
    const renderedContent = compiledTemplate(versionData);

    // Ensure the version file exists, create if it doesn't
    if (!fs.existsSync(versionFilePath)) {
      fs.writeFileSync(versionFilePath, '', 'utf8');
    }

    // Append the rendered content to the version file
    fs.appendFileSync(versionFilePath, renderedContent + '\n\n', 'utf8');
    console.log(`Version ${versionData.version} added to ${versionFilePath}`);
  } catch (error) {
    console.error('Error updating version file:', error);
  }
};

const fetchJsonFromRepo = async (gitUrl, tagName, filePath) => {
  try {
    // Extract owner and repo from the Git URL
    const match = gitUrl.match(/github\.com\/([^/]+)\/([^/]+)(?:\.git)?/);
    if (!match) throw new Error('Invalid GitHub URL');

    const owner = match[1];
    let repo = match[2];

    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }

    // Construct the GitHub API URL
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${tagName}`;

    // Fetch the file content from GitHub
    const response = await axios.get(apiUrl, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });

    if (!response.status === 200) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    // Decode the Base64 content
    const jsonContent = JSON.parse(Buffer.from(response.data.content, 'base64').toString('utf-8'));
    return jsonContent;
  } catch (error) {
    console.error('Error fetching JSON file:', error);
    throw error;
  }
};

const constructTagUrl = (gitUrl, tagName) => {
  const match = gitUrl.match(/github\.com\/([^/]+)\/([^/]+)(?:\.git)?/);
  if (!match) throw new Error('Invalid GitHub URL');

  const owner = match[1];
  let repo = match[2];

  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  return `https://github.com/${owner}/${repo}/releases/tag/${tagName}`;
};

const main = async () => {
  const versionPath = path.join(__dirname, '../..', 'version.json');
  const versionContent = fs.readFileSync(versionPath, 'utf8');

  if (!versionContent) {
    throw new Error('version.json not found');
  }

  const data = JSON.parse(versionContent);
  const dependencies = data.dependencies;
  const constructedDependencies = {};

  for (const key in dependencies) {
    const dependency = dependencies[key];
    const repoUrl = dependency.repoUrl;
    const versions = dependency.versions;
    if (!constructedDependencies[key]) {
      constructedDependencies[key] = {
        repoUrl,
        versions: [],
      };
    }

    for (const version of versions) {
      const filePath = 'version.json';
      const jsonContent = await fetchJsonFromRepo(repoUrl, version, filePath);
      const tagUrl = constructTagUrl(repoUrl, version);
      constructedDependencies[key].versions.push({ ...jsonContent, tagUrl });
    }
  }

  const tagUrl = constructTagUrl(testUntpRepo, data.version);
  const updatedVersionData = { ...data, tagUrl, dependencies: constructedDependencies };
  console.log('Updated Version Data:', JSON.stringify(updatedVersionData, null, 2));

  appendToVersionFile(updatedVersionData);
};

main();
