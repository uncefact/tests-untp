import { dynamicLoadingSchemaService } from '../../../../src/core/services/dynamic-loading-schemas/loadingSchema.service';
import {
  checkSchemaExists,
  checkSchemaVersionExists,
  getSchemaContent,
} from '../../../../src/core/services/dynamic-loading-schemas/utils';

jest.mock('../../../../src/core/services/dynamic-loading-schemas/utils', () => ({
  checkSchemaVersionExists: jest.fn(),
  checkSchemaExists: jest.fn(),
  getSchemaContent: jest.fn(),
}));

describe('loadingSchema.service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error when schema is empty', async () => {
    await expect(dynamicLoadingSchemaService('', version)).rejects.toThrow('Schema not found');
  });

  const schema = 'event';
  it('should throw an error when version is empty', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(true);
    await expect(dynamicLoadingSchemaService(schema, '')).rejects.toThrow('Version not found for schema ' + schema);
  });

  const version = 'v1.0.0';
  it('should throw an error if the schema is not found', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(false);

    await expect(dynamicLoadingSchemaService(schema, version)).rejects.toThrow('Schema not found');
    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(0);
  });

  it('should throw an error if the version is not found', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(true);
    (checkSchemaVersionExists as jest.Mock).mockResolvedValue(false);

    await expect(dynamicLoadingSchemaService(schema, version)).rejects.toThrow(
      `Version not found for schema ${schema}`,
    );
    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if the schema content is not found', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(true);
    (checkSchemaVersionExists as jest.Mock).mockResolvedValue(true);
    (getSchemaContent as jest.Mock).mockResolvedValue('');

    await expect(dynamicLoadingSchemaService(schema, version)).rejects.toThrow(`Content in ${schema} schema not found`);
    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(1);
    expect(getSchemaContent).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if an error occurs', async () => {
    const expectedError = new Error('Schema not found');
    (checkSchemaExists as jest.Mock).mockRejectedValue(expectedError);

    await expect(dynamicLoadingSchemaService(schema, version)).rejects.toThrow(expectedError);
    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(0);
  });

  it('should return the content of the schema', async () => {
    const content = { content: 'content' };
    (checkSchemaExists as jest.Mock).mockResolvedValue(true);
    (checkSchemaVersionExists as jest.Mock).mockResolvedValue(true);
    (getSchemaContent as jest.Mock).mockResolvedValue(content);
    JSON.parse = jest.fn().mockImplementation(() => {
      return content;
    });
    const result = await dynamicLoadingSchemaService(schema, version);

    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(1);
    expect(getSchemaContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual(content);
  });
});
