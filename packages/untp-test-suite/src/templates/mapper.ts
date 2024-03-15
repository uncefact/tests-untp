import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { TestSuiteResult } from '../core/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

Handlebars.registerHelper('jsonArray', (array: object) => {
  return JSON.stringify(array);
});

Handlebars.registerHelper('replace', (input: string, target: string, replacement: string) => {
  const regex = new RegExp(target, 'g');
  return input.replace(regex, replacement);
});

export async function templateMapper(templateName: string, testSuiteResult: TestSuiteResult) {
  try {
    const templateFilePath = path.join(__dirname, `./templateMessages/${templateName}.hbs`);
    const template = await fs.readFile(templateFilePath, 'utf-8');

    const compiledTemplate = Handlebars.compile(template);
    const mappedJsonString = compiledTemplate(testSuiteResult);

    return mappedJsonString;
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to run mapper template. ${error.message}`);
  }
}
