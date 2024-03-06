import { Command } from 'commander';
import chalk from 'chalk';

const log = console.log;
const test = new Command('test');
test
  .action(() => {
    log(chalk.yellow('Untp test suites are running......'));
    // Call the function to run test suites...

    log(chalk.bgGreen.white.bold('Untp test suites have completed successfully!'));
  });

export { test }
