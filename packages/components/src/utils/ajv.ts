import Ajv2020 from 'ajv/dist/2020.js';

/**
 * Create an Ajv instance with version 2020 and custom keywords and formats
 */
export function createAjv() {
  const ajv = new Ajv2020({
    strict: false,
  });

  return ajv;
}
