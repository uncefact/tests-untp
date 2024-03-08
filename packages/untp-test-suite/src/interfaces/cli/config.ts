import { Command } from 'commander';
import chalk from 'chalk';
import { createConfigFile } from './createConfigFile.js';

export const defaultConfigFilePath = './src/interfaces/cli/credentials.json';

const log = console.log;
const config = new Command('config');
config
  .description('Create Untp test suites configuration file')
  .action(async () => {
    try {
      await createConfigFile(defaultConfigFilePath);

      log(chalk.green.bold('Config file \'credentials.json\' created successfully!'));
    } catch (error) {
      log(chalk.bgRed.white.bold('Create the credentials file failed'));
      log(chalk.red(error));
    }
  });

export { config }
