import { Command } from 'commander';
import { processCreateConfig } from '../lib/index.js';

const config = new Command('config');
config
  .description('Create Untp test suites configuration file')
  .action(async () => {
    await processCreateConfig();
  });

export { config }
