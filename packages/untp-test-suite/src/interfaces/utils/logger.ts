import chalk from 'chalk';
import Table from 'cli-table3';
import { getPackageVersion } from '../../utils/common.js';

export enum TestSuiteResultEnum {
  PASS = 'PASS',
  FAIL = 'FAIL',
  WARN = 'WARN',
}

export function getLogStatus(testSuiteResults: any[]) {
  let resultMessage = '';

  for (const testSuiteResult of testSuiteResults) {
    const { credentialType, version, path, result } = testSuiteResult;

    const credentialMessage = getCredentialTypeMessage(credentialType);
    const versionMessage = getVersionMessage(version);
    const pathMessage = getPathMessage(path);
    const statusMessage = getStatusMessage(result as TestSuiteResultEnum);
    const errorOrWarningMessage = getErrorOrWarningMessage(testSuiteResult);

    resultMessage += `${credentialMessage}${versionMessage}${pathMessage}${statusMessage}${errorOrWarningMessage}`;
    resultMessage += '\n---\n';
  }

  return resultMessage;
}

export function getFinalReport(testSuiteResult: any) {
  const { testSuiteResults } = testSuiteResult;
  if (!testSuiteResults || !testSuiteResults.length) {
    return '';
  }

  const packageVersion = getPackageVersion();
  const table = new Table({ colWidths: [40] });

  const credentialStatuses = testSuiteResults.map((testResult: any) => [
    testResult.credentialType,
    testResult.version,
    getMessageWithColorByResult(testResult.result, testResult.result),
  ]);

  table.push([{ colSpan: 3, content: chalk.blue.bold('UNTP Core Test Suite'), hAlign: 'center' }]);
  table.push([{ colSpan: 3, content: chalk.blue.bold(`Runner version ${packageVersion}`), hAlign: 'center' }]);
  table.push(['Credential Type', 'Version', 'Status']);
  table.push(...credentialStatuses);
  table.push([
    {
      colSpan: 3,
      content: getMessageWithColorByResult(testSuiteResult.finalStatus, testSuiteResult.finalMessage),
      hAlign: 'center',
    },
  ]);

  return table.toString();
}

export function getCredentialTypeMessage(credentialType: string) {
  return `Testing Credential: ${credentialType}\n`;
}

export function getVersionMessage(version: string) {
  return `Version: ${version}\n`;
}

export function getPathMessage(path: string) {
  return `Path: ${path}\n`;
}

export function getStatusMessage(result: TestSuiteResultEnum) {
  let statusMessage = `Status: ${getMessageWithColorByResult(result, result)}`;
  if (result !== TestSuiteResultEnum.PASS) {
    statusMessage += '\n';
  }

  return statusMessage;
}

export function getErrorOrWarningMessage(testSuiteResult: any) {
  if (testSuiteResult.result === 'FAIL') {
    return chalk.red(`Error: ${getErrorMessage(testSuiteResult.errors)}`);
  }
  if (testSuiteResult.result === 'WARN') {
    return chalk.yellow(`Warning: ${getWarningMessage(testSuiteResult.warnings)}`);
  }

  return '';
}

export function getWarningMessage(warnings: any[] | null) {
  if (!warnings) {
    return '';
  }

  let warningMessage = '';
  for (const warning of warnings) {
    warningMessage += `${warning.message as string}.`;
  }

  return warningMessage;
}

export function getErrorMessage(errors: any[] | null) {
  if (!errors) {
    return '';
  }

  let errorMessage = '';
  for (const error of errors) {
    errorMessage += `${error.message as string}. `;
    errorMessage += error?.allowedValues ? `Allowed values: ${(error.allowedValues as string[]).join(', ')}.` : '';
  }

  return errorMessage;
}

export function getMessageWithColorByResult(result: TestSuiteResultEnum, message: string) {
  const colorMap = {
    [TestSuiteResultEnum.FAIL]: chalk.red,
    [TestSuiteResultEnum.WARN]: chalk.yellow,
    [TestSuiteResultEnum.PASS]: chalk.green,
  };

  return colorMap[result](message);
}
