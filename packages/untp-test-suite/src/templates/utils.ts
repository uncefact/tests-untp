import { ErrorObject } from 'ajv';
import {
  IValidatedCredentials,
  TestSuiteResultEnum,
  ICredentialTestResult,
  IFinalReport,
  TestSuiteMessageEnum,
  IValidationTemplateData,
  TemplateEnum,
} from '../core/types/index.js';
import { templateMapper } from './mapper.js';

export const getTemplateData = (validatedCredential: IValidatedCredentials): IValidationTemplateData => {
  const errors = validatedCredential.errors as ErrorObject[];
  const templates = [TemplateEnum.CREDENTIAL_RESULT];

  // Pass template
  const isPassTemplate = !errors?.length;
  if (isPassTemplate) {
    return {
      result: TestSuiteResultEnum.PASS,
      templates,
    };
  }

  // Error or Error and warning template
  const { errorList, warningList } = errors.reduce(
    (result, current) => {
      const errorOrWarningList = current.params?.additionalProperty ? result.warningList : result.errorList;
      if (current.message) {
        current.message = replaceQuotesToSingleQuote(current.message);
      }
      errorOrWarningList.push(current);

      return result;
    },
    {
      errorList: [] as ErrorObject[],
      warningList: [] as ErrorObject[],
    },
  );

  let result = TestSuiteResultEnum.WARN;
  if (errorList.length) {
    result = TestSuiteResultEnum.FAIL;
    templates.push(TemplateEnum.ERRORS);
  }
  if (warningList.length) {
    templates.push(TemplateEnum.WARNINGS);
  }

  return {
    result,
    errors: errorList,
    warnings: warningList,
    templates,
  };
};

export const constructCredentialTestResults = async (
  validatedCredentials: IValidatedCredentials[],
): Promise<ICredentialTestResult[]> => {
  const credentialResultPromises = validatedCredentials.map(async (validatedCredential) =>
    constructCredentialTestResult(validatedCredential),
  );

  const credentialResults = await Promise.all(credentialResultPromises);
  return credentialResults;
};

export const constructCredentialTestResult = async (
  validatedCredential: IValidatedCredentials,
): Promise<ICredentialTestResult> => {
  const { templates, ...templateData } = getTemplateData(validatedCredential);
  const mappedTemplateCredentialTestResults = await Promise.all(
    templates.map(async (template) => {
      const mappedTemplateDataJson = await templateMapper(template, { ...validatedCredential, ...templateData });
      return JSON.parse(mappedTemplateDataJson) as ICredentialTestResult;
    }),
  );

  const credentialTestResult = mappedTemplateCredentialTestResults.reduce(
    (result, current) => ({ ...result, ...current }),
    {} as ICredentialTestResult,
  );
  return credentialTestResult;
};

export const constructFinalReport = async (credentialResults: ICredentialTestResult[]): Promise<IFinalReport> => {
  const initFinalReport = {
    finalStatus: TestSuiteResultEnum.PASS,
    finalMessage: TestSuiteMessageEnum.PASS,
  } as IFinalReport;

  const finalReportTemplate = credentialResults.reduce((acc, credential) => {
    if (credential.result === TestSuiteResultEnum.WARN && acc.finalStatus !== TestSuiteResultEnum.FAIL) {
      acc.finalMessage = TestSuiteMessageEnum.WARN;
      acc.finalStatus = TestSuiteResultEnum.WARN;
    }

    if (credential.result === TestSuiteResultEnum.FAIL) {
      acc.finalMessage = TestSuiteMessageEnum.FAIL;
      acc.finalStatus = TestSuiteResultEnum.FAIL;
    }

    return acc;
  }, initFinalReport);

  const finalReportJson = await templateMapper(TemplateEnum.FINAL_REPORT, finalReportTemplate);
  return JSON.parse(finalReportJson);
};

const replaceQuotesToSingleQuote = (text: string) => text.replace(/"/g, "'");
