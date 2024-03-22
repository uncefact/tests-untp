import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import _ from 'lodash';
import { IFinalReport, IValidatedCredentials } from '../core/types/index.js';
import { getCurrentDirPath, getCurrentFilePath } from '../utils/path.js';

Handlebars.registerHelper('jsonStringify', (jsonObject: object) => {
  if (!_.isObject(jsonObject) || _.isEmpty(jsonObject)) {
    throw new Error(
      `An error occurred in the Handlebars registerHelper 'jsonStringify' function. Please provide a valid JSON object.`,
    );
  }

  return JSON.stringify(jsonObject);
});

export async function templateMapper(templateName: string, testSuiteResult: IValidatedCredentials | IFinalReport) {
  try {
    const currentDirPath = getCurrentDirPath(getCurrentFilePath());
    const templateFilePath = path.join(currentDirPath, `../templates/templateMessages/${templateName}.hbs`);
    const template = await fs.readFile(templateFilePath, 'utf-8');

    const compiledTemplate = Handlebars.compile(template);
    const mappedJsonString = compiledTemplate(testSuiteResult);

    return mappedJsonString;
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to run mapper template. ${error.message}`);
  }
}
