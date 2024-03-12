import path from 'path';
import chalk from 'chalk';
import { readJsonFile } from '../utils/index.js';
import { createConfigFile } from './createConfigFile.js';
import { CreateConfigHandler, TestSuiteHandler } from '../types/index.js';

const log = console.log;
const rootPath = process.cwd();
const configFileName = 'credentials.json';
export const defaultConfigFilePath = `${rootPath}/${configFileName}`;

export const processTestSuite: TestSuiteHandler = async (options: any) => {
  try {
  log(chalk.yellow('Untp test suites are running......'));

    let configPath = defaultConfigFilePath;
    if (options.config) {
      configPath = path.resolve(rootPath, configPath);
    }

    const testSuiteResults = await processTestSuite(configPath);
    log(chalk.bgGreen.white.bold('Untp test suites have completed successfully!'));
  } catch (error) {
    log(chalk.bgRed.white.bold('Run Untp test suites failed'));
    log(chalk.red(error));
  }
}

export const processCreateConfig: CreateConfigHandler = async () => {
  try {
    const configFilePath = `${process.cwd()}/${configFileName}`;
    const configFile = await readJsonFile(configFilePath);
    if (configFile) {
      return log(chalk.bgRed.white.bold(`Config file '${configFileName}' already exists!`));
    }

    await createConfigFile(`${process.cwd()}/${configFileName}`);

    log(chalk.bgGreen.white.bold(`Config file '${configFileName}' created successfully!`));
  } catch (error) {
    log(chalk.bgRed.white.bold('Create the credentials file failed!'));
    log(chalk.red(error));
  }
}