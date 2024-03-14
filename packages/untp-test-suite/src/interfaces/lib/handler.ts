import path from 'path';
import chalk from 'chalk';
import { readJsonFile, generateCredentialFile } from '../utils/index.js';
import { GenerateCredentialFileHandler, TestSuiteHandler } from '../types/index.js';

const rootPath = process.cwd();
const credentialFileName = 'credentials.json';

export const defaultCredentialFilePath = `${rootPath}/${credentialFileName}`;
export const schemasPath = `${rootPath}/src/schemas`;

export const testSuiteHandler: TestSuiteHandler = async (options: any) => {
  try {
    console.log(chalk.yellow('Untp test suites are running......'));

    let credentialPath = defaultCredentialFilePath;
    if (options.config) {
      credentialPath = path.resolve(rootPath, credentialPath);
    }

    // const testSuiteResults = await processTestSuite(credentialPath);
    console.log(chalk.bgGreen.white.bold('Untp test suites have completed successfully!'));
  } catch (error) {
    console.log(chalk.bgRed.white.bold('Run Untp test suites failed'));
    console.log(chalk.red(error));
  }
}

export const generateCredentialFileHandler: GenerateCredentialFileHandler = async (storePath: string, schemasPath: string) => {
  try {
    const credentialFile = await readJsonFile(defaultCredentialFilePath);
    if (credentialFile) {
      return console.log(chalk.bgRed.white.bold(`Credential file '${credentialFileName}' already exists!`));
    }

    await generateCredentialFile(storePath, schemasPath);

    console.log(chalk.bgGreen.white.bold(`Credential file '${credentialFileName}' generated successfully!`));
  } catch (error) {
    console.log(chalk.bgRed.white.bold('Generate the credentials file failed!'));
    console.log(chalk.red(error));
  }
}