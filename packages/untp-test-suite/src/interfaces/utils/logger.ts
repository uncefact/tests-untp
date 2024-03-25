import chalk from 'chalk';
import Table from 'cli-table3';
import { getPackageVersion } from '../../utils/common.js';
import { ICredentialTestResult, IError, IWarning, TestSuiteResult, TestSuiteResultEnum } from '../../core/types/index.js';

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

export function getFinalReport(testSuiteResult: TestSuiteResult) {
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
  let statusMessage = `Result: ${getMessageWithColorByResult(result, result)}`;
  if (result !== TestSuiteResultEnum.PASS) {
    statusMessage += '\n';
  }

  return statusMessage;
}

export function getErrorOrWarningMessage(testSuiteResult: ICredentialTestResult) {
  if (testSuiteResult.result === TestSuiteResultEnum.FAIL && testSuiteResult.errors && testSuiteResult.warnings) {
    return `${chalk.yellow(`Warning: ${getWarningMessage(testSuiteResult.warnings)}`)}\n${chalk.red(`Error: ${getErrorMessage(testSuiteResult.errors)}`)}`;
  }
  if (testSuiteResult.result === TestSuiteResultEnum.FAIL && testSuiteResult.errors) {
    return chalk.red(`Error: ${getErrorMessage(testSuiteResult.errors)}`);
  }
  if (testSuiteResult.result === TestSuiteResultEnum.WARN && testSuiteResult.warnings) {
    return chalk.yellow(`Warning: ${getWarningMessage(testSuiteResult.warnings)}`);
  }

  return '';
}

export function getWarningMessage(warnings: IWarning[]) {
  let warningMessage = '';

  for (const warning of warnings) {
    warningMessage += `${warning.message}. Additional property found: '${warning.fieldName}'.`;
  }

  return warningMessage;
}

export function getErrorMessage(errors: IError[]) {
  let errorMessage = '';

  for (const error of errors) {
    errorMessage += `${error.message}. `;
    errorMessage += error?.allowedValues ? `Allowed values: ${(error.allowedValues).join(', ')}.` : '';
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
