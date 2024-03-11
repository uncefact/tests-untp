import { hasErrors } from '../../../../src/core/services/json-schema/validator.service';

describe('Validator Service', () => {
  describe('hasErrors', () => {
    it('should return null if no errors are found', () => {
      const schema = {
        type: 'object',
        properties: {
          foo: { type: 'integer' },
          bar: { type: 'string' },
        },
        required: ['foo'],
        additionalProperties: false,
      };
      const data = {
        foo: 1,
        bar: 'abc',
      };

      const result = hasErrors(schema, data);

      expect(result).toBeNull();
    });
  });
});
