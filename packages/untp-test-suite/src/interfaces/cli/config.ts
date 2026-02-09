import { Command } from 'commander';
import chalk from 'chalk';
import { generateCredentialFile, readJsonFile } from '../utils/index.js';

const config = new Command('config');
config.description('Create Untp test suites configuration file').action(async () => {
  try {
    const credentialFileName = 'credentials.json';
    const storePath = `${process.cwd()}/${credentialFileName}`;

    const credentialFile = await readJsonFile(storePath);
    if (credentialFile) {
      throw new Error(`Credential file '${credentialFileName}' already exists!`);
    }

    await generateCredentialFile(storePath);

    console.log(chalk.bgGreen.white.bold(`Credential file '${credentialFileName}' generated successfully!`));
  } catch (error) {
    console.log(chalk.bgRed.white.bold('Generate the credentials file failed!'));
    console.log(chalk.red(error));
  }
});

export { config };
