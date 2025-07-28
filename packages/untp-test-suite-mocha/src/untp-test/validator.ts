/**
 * UNTP Mocha Runner - Executes Mocha tests for UNTP credential validation
 */

import { UNTPTestOptions } from './types';
import { StreamReporter, StreamEvent } from './stream-reporter';

export interface UNTPTestResults {
  success: boolean;
  stats: {
    suites: number;
    tests: number;
    passes: number;
    pending: number;
    failures: number;
    duration: number;
  };
}

/**
 * Executes Mocha tests for UNTP credential validation
 *
 * This class provides programmatic access to run UNTP validation tests
 * in both Node.js and browser environments using a custom streaming reporter.
 * Credential data should be set via credential-state module before calling run().
 */
export class UNTPTestRunner {
  /**
   * Run Mocha tests against UNTP credentials with streaming results
   *
   * Uses custom reporter to provide real-time test results that are
   * streamed to the onStream callback as they happen.
   * Works in both Node.js and browser environments.
   * Credential data should be set via credential-state module before calling run().
   */
  async run(options: UNTPTestOptions, onStream?: (event: StreamEvent) => void): Promise<UNTPTestResults> {
    return new Promise((resolve, reject) => {
      try {
        // Create Mocha options with custom streaming reporter and grep support
        const mochaOptions: any = {
          reporter: StreamReporter as any,
          timeout: 5000,
          bail: false,
          reporterOptions: {
            onStream: onStream,
          },
        };

        // Add tag filtering using grep if specified
        if (options.tags && options.tags.length > 0) {
          const tagPattern = options.tags.map((tag: string) => `\\btag:${tag}\\b`).join('|');
          mochaOptions.grep = tagPattern;
        }

        // Get configured Mocha instance from callback
        const mocha = options.mochaSetupCallback(mochaOptions);

        // Track results for final summary
        const results: UNTPTestResults = {
          success: false,
          stats: {
            suites: 0,
            tests: 0,
            passes: 0,
            pending: 0,
            failures: 0,
            duration: 0,
          },
        };

        // Run the tests
        const runner = mocha.run((failures: any) => {
          results.success = failures === 0;
          resolve(results);
        });

        // Update results from runner stats at the end
        runner.on('end', () => {
          if (runner.stats) {
            results.stats = {
              suites: runner.stats.suites || 0,
              tests: runner.stats.tests || 0,
              passes: runner.stats.passes || 0,
              pending: runner.stats.pending || 0,
              failures: runner.stats.failures || 0,
              duration: runner.stats.duration || 0,
            };
          }
        });

        runner.on('error', (error: any) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}
