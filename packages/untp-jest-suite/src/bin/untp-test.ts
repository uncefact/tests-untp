#!/usr/bin/env node

/**
 * UNTP Test CLI - Jest wrapper for UNTP credential validation
 */

import { Command } from 'commander';
import { UNTPJestRunner } from '../validator';

const program = new Command();

program
  .name('untp-test')
  .description('UNTP credential validation using Jest')
  .version('0.1.0')
  .option('-d, --directory <dir>', 'add files from directory to the test list')
  .arguments('[files...]')
  .action(async (files: string[], options) => {
    const allFiles = [...files]; // Start with provided file paths

    if (options.directory) {
      console.log(`Adding files from directory: ${options.directory}`);
      // TODO: Scan directory and add files to allFiles array
      allFiles.push(`${options.directory}/*`); // Placeholder - will implement scanning later
    }

    if (allFiles.length === 0) {
      console.error('No files specified. Provide file paths or use --directory option.');
      process.exit(1);
    }

    console.log(`Testing credential files: ${allFiles.join(', ')}`);

    try {
      // Use the reusable UNTPJestRunner - same code that web UIs would use
      const runner = new UNTPJestRunner();
      const result = await runner.run({
        credentialPaths: allFiles,
      });

      console.log('Test execution completed:', result);
      process.exit(0);
    } catch (error) {
      console.error('Test execution failed:', error);
      process.exit(1);
    }
  });

program.parse();
