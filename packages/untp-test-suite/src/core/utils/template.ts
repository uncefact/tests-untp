import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { TestSuiteResult } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function templateMapper(templateName: string, schemaValidationResult: TestSuiteResult) {
  const templateFilePath = path.join(__dirname, `../templates/${templateName}.json`);
  const templateFile = await fs.readFile(templateFilePath, 'utf-8');

  const template = Handlebars.compile(templateFile);
  const mappedJsonString = template(schemaValidationResult);

  return mappedJsonString;
}
