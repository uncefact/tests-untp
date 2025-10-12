import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { IHasErrors } from './types.js';

const getAjv2020 = () => {
  let ajv2020: Ajv2020 | undefined;

  if (!ajv2020) {
    ajv2020 = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv2020);
  }
  return ajv2020;
};

/**
 *
 * This function is used to check if the data has errors based on the schema.
 *
 * @param schema schema is used to check the data
 * @param data data is the object to be checked
 * @returns null if no errors are found, otherwise an array of errors
 */
export const hasErrors: IHasErrors = (schema: any, data: any) => {
  const ajv = getAjv2020();
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid && validate.errors && validate.errors.length > 0) {
    return validate.errors;
  }
  return null;
};
