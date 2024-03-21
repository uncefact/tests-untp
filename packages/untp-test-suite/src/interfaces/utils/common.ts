import { readFile } from 'fs/promises';
import {
  ICredentialTestResult,
  IFinalReport,
  TemplateName,
  IValidatedCredentials,
  TestSuiteMessage,
  FinalStatus,
} from '../../core/types';
import { ErrorObject } from 'ajv';

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const fileJson = await readFile(filePath, { encoding: 'utf-8' });
    const file = JSON.parse(fileJson);

    return file;
  } catch (error) {
    return null;
  }
}

export const getTemplateName = (testSuiteResult: IValidatedCredentials): string => {
  if (testSuiteResult.errors === null) {
    return TemplateName.pass;
  }

  if (Array.isArray(testSuiteResult.errors) && testSuiteResult.errors.length > 0) {
    const getErrors = testSuiteResult.errors as ErrorObject[];
    const errorWithAdditionalProperty = getErrors.find((error) => error?.params?.additionalProperty);
    if (errorWithAdditionalProperty) {
      // If any ErrorObject has 'additionalProperty', return 'warning'
      return TemplateName.warn;
    }

    // If no ErrorObject has 'additionalProperty', return 'FAIL'
    return TemplateName.error;
  } else {
    return TemplateName.pass;
  }
};

export const generateFinalMessage = (credentials: ICredentialTestResult[]): IFinalReport => {
  let finalMessage = TestSuiteMessage.Pass;
  let finalStatus: FinalStatus = FinalStatus.pass;

  if (credentials.some((credential) => credential.result === FinalStatus.warn)) {
    finalMessage = TestSuiteMessage.Warning;
    finalStatus = FinalStatus.warn;
  }

  if (credentials.some((credential) => credential.result === FinalStatus.fail)) {
    finalMessage = TestSuiteMessage.Fail;
    finalStatus = FinalStatus.fail;
  }

  return {
    finalStatus,
    finalMessage,
  };
};
