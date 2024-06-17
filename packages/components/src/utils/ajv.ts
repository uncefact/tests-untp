import Ajv2020 from 'ajv/dist/2020.js';

/**
 * Create an Ajv instance with version 2020 and custom keywords and formats
 */
export function createAjv() {
  const ajv = new Ajv2020();
  ajv.addKeyword('x-jargon-isKey');
  ajv.addKeyword('example');
  ajv.addKeyword('x-external-enumeration');
  ajv.addFormat('uri', {
    validate: (data: string) => {
      try {
        new URL(data);
        return true;
      } catch (e) {
        return false;
      }
    },
  });

  ajv.addFormat('date', {
    validate: (data: string) => {
      try {
        new Date(data);
        return true;
      } catch (e) {
        return false;
      }
    },
  });

  ajv.addFormat('date-time', {
    validate: (data: string) => {
      try {
        new Date(data);
        return true;
      } catch (e) {
        return false;
      }
    },
  });

  return ajv;
}
