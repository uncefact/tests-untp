import chalk from 'chalk';
import Table from 'cli-table3';
import { getPackageVersion } from '../../utils/common.js';
import {
  ICredentialTestResult,
  IError,
  IWarning,
  ITestSuiteResult,
  TestSuiteResultEnum,
} from '../../core/types/index.js';

export function getLogStatus(credentialTestResults: ICredentialTestResult[]) {
  let resultMessage = '';

  for (const testSuiteResult of credentialTestResults) {
    const { credentialType, version, path, result } = testSuiteResult;

    const credentialMessage = getCredentialTypeMessage(credentialType);
    const versionMessage = getVersionMessage(version);
    const pathMessage = getPathMessage(path);
    const statusMessage = getStatusMessage(result);
    const errorOrWarningMessage = getErrorOrWarningMessage(testSuiteResult);

    resultMessage += `${credentialMessage}${versionMessage}${pathMessage}${statusMessage}${errorOrWarningMessage}`;
    resultMessage += '\n---\n';
  }

  return resultMessage;
}

export function getFinalReport(testSuiteResult: ITestSuiteResult) {
  const { credentials: credentialTestResults } = testSuiteResult;
  if (!credentialTestResults.length) {
    return '';
  }

  const packageVersion = getPackageVersion();
  const table = new Table({ colWidths: [40] });

  const credentialStatuses = credentialTestResults.map((credentialTestResult) => [
    credentialTestResult.credentialType,
    credentialTestResult.version,
    getMessageWithColorByResult(credentialTestResult.result, credentialTestResult.result),
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

function getCredentialTypeMessage(credentialType: string) {
  return `Testing Credential: ${credentialType}\n`;
}

function getVersionMessage(version: string) {
  return `Version: ${version}\n`;
}

function getPathMessage(path: string) {
  return `Path: ${path}\n`;
}

function getStatusMessage(result: TestSuiteResultEnum) {
  let statusMessage = `Result: ${getMessageWithColorByResult(result, result)}`;
  if (result !== TestSuiteResultEnum.PASS) {
    statusMessage += '\n';
  }

  return statusMessage;
}

function getErrorOrWarningMessage(testSuiteResult: ICredentialTestResult) {
  if (testSuiteResult.result === TestSuiteResultEnum.FAIL && testSuiteResult.errors && testSuiteResult.warnings) {
    return `${chalk.yellow(`Warning: ${getMessage(testSuiteResult.warnings)}`)}\n${chalk.red(
      `Error: ${getMessage(testSuiteResult.errors)}`,
    )}`;
  }
  if (testSuiteResult.result === TestSuiteResultEnum.FAIL && testSuiteResult.errors) {
    return chalk.red(`Error: ${getMessage(testSuiteResult.errors)}`);
  }
  if (testSuiteResult.result === TestSuiteResultEnum.WARN && testSuiteResult.warnings) {
    return chalk.yellow(`Warning: ${getMessage(testSuiteResult.warnings)}`);
  }

  return '';
}

function getMessage(resultMessages: IWarning[] | IError[]) {
  let finalMessage = '';

  for (const resultMessage of resultMessages) {
    finalMessage += `\n${resultMessage.message}`;
  }

  return finalMessage;
}

function getMessageWithColorByResult(result: TestSuiteResultEnum, message: string) {
  const colorMap = {
    [TestSuiteResultEnum.FAIL]: chalk.red,
    [TestSuiteResultEnum.WARN]: chalk.yellow,
    [TestSuiteResultEnum.PASS]: chalk.green,
  };

  return colorMap[result](message);
}
