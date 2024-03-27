import { ErrorObject } from 'ajv';
import {
  IValidatedCredentials,
  TestSuiteResultEnum,
  ICredentialTestResult,
  IFinalReport,
  TestSuiteMessage,
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
      templates
    };
  }
  
  // Error or Error and warning template
  const { errorList, warningList } = errors.reduce((result, current) => {
    const errorOrWarningList = current.params?.additionalProperty ? result.warningList : result.errorList;
    errorOrWarningList.push(current);

    return result;
  }, {
    errorList: [] as ErrorObject[],
    warningList: [] as ErrorObject[]
  });

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
    templates
  };
};

export const getCredentialResults = async (validatedCredentials: IValidatedCredentials[]): Promise<ICredentialTestResult[]> => {
  const credentialResultPromises = validatedCredentials.map(async (validatedCredential) => {
    const { templates, ...templateData } = getTemplateData(validatedCredential);

    const mappedTemplateComponentPromises = templates.map(async (template) => {
      const mappedTemplateDataJson = await templateMapper(template, { ...validatedCredential, ...templateData });
      const mappedTemplateData = JSON.parse(mappedTemplateDataJson);

      return mappedTemplateData as ICredentialTestResult;
    });

    const mappedTemplateComponents = await Promise.all(mappedTemplateComponentPromises);
    const mappedTemplate = mappedTemplateComponents.reduce((result, current) => ({ ...result, ...current }), {} as ICredentialTestResult);
    return mappedTemplate;
  });

  const credentialResults = await Promise.all(credentialResultPromises);
  return credentialResults;
};

export const getFinalReport = async (credentialResults: ICredentialTestResult[]): Promise<IFinalReport> => {
  const initFinalReport = { finalStatus: TestSuiteResultEnum.PASS, finalMessage: TestSuiteMessage.Pass } as IFinalReport;

  const finalReportTemplateData = credentialResults.reduce((acc, credential) => {
    if (credential.result === TestSuiteResultEnum.WARN && acc.finalStatus !== TestSuiteResultEnum.FAIL) {
      acc.finalMessage = TestSuiteMessage.Warning;
      acc.finalStatus = TestSuiteResultEnum.WARN;
    }

    if (credential.result === TestSuiteResultEnum.FAIL) {
      acc.finalMessage = TestSuiteMessage.Fail;
      acc.finalStatus = TestSuiteResultEnum.FAIL;
    }

    return acc;
  }, initFinalReport);

  const finalReportJson = await templateMapper(TemplateEnum.FINAL_REPORT, finalReportTemplateData);
  return JSON.parse(finalReportJson);
};
