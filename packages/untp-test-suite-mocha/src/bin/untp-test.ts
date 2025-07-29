#!/usr/bin/env node

/**
 * UNTP Test CLI - Mocha wrapper for UNTP credential validation
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { UNTPTestRunner } from '../untp-test/validator';
import { StreamEvent } from '../untp-test/stream-reporter';
import { setCredentialData } from '../untp-test/credential-state';
import * as fs from 'fs';
import * as path from 'path';

// Set up global fetch for Node.js environment
if (typeof (global as any).fetch === 'undefined') {
  const nodeFetch = require('node-fetch');
  (global as any).fetch = nodeFetch;
}

const program = new Command();

// Track displayed suites to show proper hierarchy
const displayedSuites = new Set<string>();

function handleStreamEvent(event: StreamEvent): void {
  switch (event.type) {
    case 'start':
      console.log('\nRunning UNTP validation tests...\n');
      displayedSuites.clear();
      break;

    case 'pass':
      // Show hierarchical suite structure
      showSuiteHierarchy(event.data.suiteHierarchy);

      // Print passing test with tags
      const testDuration = event.data.duration ? ` ${chalk.gray(`(${event.data.duration}ms)`)}` : '';
      const indent = event.data.suiteHierarchy.length * 2 + 2;
      const { cleanTitle: cleanTestTitle, tags: testTags } = (global as any).untpTestSuite.formatTags(event.data.title);
      const formattedTestTags = testTags ? ` ${chalk.dim(testTags)}` : '';
      console.log(
        `${' '.repeat(indent)}${chalk.green('✔')} ${chalk.gray(cleanTestTitle)}${formattedTestTags}${testDuration}`,
      );
      break;

    case 'fail':
      // Show hierarchical suite structure
      showSuiteHierarchy(event.data.suiteHierarchy);

      // Print failing test with tags
      const failIndent = event.data.suiteHierarchy.length * 2 + 2;
      const { cleanTitle: cleanFailTitle, tags: failTestTags } = (global as any).untpTestSuite.formatTags(
        event.data.title,
      );
      const formattedFailTestTags = failTestTags ? ` ${chalk.dim(failTestTags)}` : '';
      console.log(`${' '.repeat(failIndent)}${chalk.red('✖')} ${cleanFailTitle}${formattedFailTestTags}`);
      if (event.data.err && event.data.err.message) {
        console.log(`${' '.repeat(failIndent + 2)}${chalk.red(event.data.err.message)}`);
      }
      break;

    case 'pending':
      // Show hierarchical suite structure
      showSuiteHierarchy(event.data.suiteHierarchy);

      // Print pending test with tags
      const pendingIndent = event.data.suiteHierarchy.length * 2 + 2;
      const { cleanTitle: cleanPendingTitle, tags: pendingTestTags } = (global as any).untpTestSuite.formatTags(
        event.data.title,
      );
      const formattedPendingTestTags = pendingTestTags ? ` ${chalk.dim(pendingTestTags)}` : '';
      console.log(`${' '.repeat(pendingIndent)}${chalk.cyan('-')} ${cleanPendingTitle}${formattedPendingTestTags}`);
      break;

    case 'end':
      console.log(''); // Empty line before summary

      // Print summary
      const stats = event.data;
      const totalDuration = stats.duration ? `${stats.duration}ms` : '0ms';

      if (stats.passes > 0) {
        console.log(`  ${chalk.green(`${stats.passes} passing`)} ${chalk.gray(`(${totalDuration})`)}`);
      }

      if (stats.failures > 0) {
        console.log(`  ${chalk.red(`${stats.failures} failing`)}`);
      }

      if (stats.pending > 0) {
        console.log(`  ${chalk.cyan(`${stats.pending} pending`)}`);
      }

      console.log(''); // Empty line after summary
      break;
  }
}

/**
 * Show suite hierarchy using shared function with CLI-specific output
 */
function showSuiteHierarchy(suiteHierarchy: string[]): void {
  (global as any).untpTestSuite.showSuiteHierarchy(
    suiteHierarchy,
    displayedSuites,
    (suiteTitle: string, cleanTitle: string, tags: string, indentLevel: number) => {
      const indent = ' '.repeat(indentLevel * 2);
      const formattedTags = tags ? ` ${chalk.dim(tags)}` : '';
      console.log(`${indent}${chalk.bold(cleanTitle)}${formattedTags}`);
    },
  );
}

program
  .name('untp-test')
  .description('UNTP credential validation using Mocha')
  .version('0.1.0')
  .option('-d, --directory <dir>', 'add files from directory to the test list')
  .option(
    '-t, --tag <tag>',
    'run only tests with this tag (can be used multiple times)',
    (value: string, previous: string[]) => {
      return previous ? previous.concat([value]) : [value];
    },
  )
  .arguments('[files...]')
  .action(async (files: string[], options: any) => {
    const allFiles = [...files]; // Start with provided file paths

    if (options.directory) {
      console.log(`Adding credential files from directory: ${options.directory}`);
      // TODO: Scan directory and add files to allFiles array
      allFiles.push(`${options.directory}/*`); // Placeholder - will implement scanning later
    }

    if (allFiles.length === 0) {
      console.error('No files specified. Provide file paths or use --directory option.');
      process.exit(1);
    }

    console.log(`Testing credential files: ${allFiles.join(', ')}`);

    try {
      // Read credential files directly and populate credential state
      const credentialData = new Map<string, string>();

      for (const filePath of allFiles) {
        try {
          const stats = await fs.promises.stat(filePath);

          if (!stats.isFile()) {
            console.warn(`Skipping ${filePath}: not a file`);
            continue;
          }

          const content = await fs.promises.readFile(filePath, 'utf8');
          const fileName = path.basename(filePath);

          // Validate JSON format
          JSON.parse(content);

          credentialData.set(fileName, content);
        } catch (error) {
          console.warn(`Skipping invalid JSON file ${filePath}:`, error);
        }
      }

      if (credentialData.size === 0) {
        console.error('No valid JSON credential files found');
        process.exit(1);
      }

      // Set credential data for tests
      setCredentialData(credentialData);

      // Use UNTPTestRunner with streaming callback
      const runner = new UNTPTestRunner();
      const results = await runner.run(
        {
          tags: options.tag,
          mochaSetupCallback: (mochaOptions) => {
            // Create Mocha instance with Node.js import
            const Mocha = require('mocha');
            const mocha = new Mocha(mochaOptions);

            // Set up test helpers globally before adding test files
            require('../untp-test/utils');

            // Load all UNTP test files by scanning the untp-tests directory
            const path = require('path');
            const fs = require('fs');
            const testsDir = path.join(__dirname, '../../untp-tests');

            try {
              const files = fs.readdirSync(testsDir);
              files
                .filter((file: string) => file.endsWith('.test.js'))
                .forEach((file: string) => {
                  require(path.join(testsDir, file));
                });
            } catch (error) {
              console.error('Error loading UNTP test files:', error);
            }

            // If additional tests directory is specified, add those tests too
            if (options.additionalTestsDir) {
              // TODO: Implement additional test directory scanning
              console.log(`Would scan additional tests in: ${options.additionalTestsDir}`);
            }

            // Set up BDD interface globals (describe, it, before, etc.)
            mocha.suite.emit('pre-require', global, null, mocha);

            // Execute registered test suites after test files are loaded and BDD is available
            (global as any).untpTestSuite.executeRegisteredTestSuites();

            return mocha;
          },
        },
        handleStreamEvent,
      );

      // Exit with appropriate code based on test results
      process.exit(results.success ? 0 : 1);
    } catch (error) {
      console.error('Test execution failed:', error);
      process.exit(1);
    }
  });

program.parse();
