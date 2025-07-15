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

  it('should throw an error when schema does not exist', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(false);
    const credentialConfig = {
      type: 'DigitalProductPassport',
      version,
      url: '',
      dataPath: '/path/to/schema',
    };

    const result = await dynamicLoadingSchemaService(credentialConfig);
    expect(result).toEqual('Schema not found');
  });

  it('should throw an error when type is empty', async () => {
    const credentialConfig = {
      type: '',
      version,
      url: '',
      dataPath: '/path/to/schema',
    };

    const result = await dynamicLoadingSchemaService(credentialConfig);
    expect(result).toEqual('Type is required for local schema loading');
  });

  const schema = 'event';
  it('should throw an error when version is empty', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(true);
    const credentialConfig = {
      type: schema,
      version: '',
      url: '',
      dataPath: '/path/to/schema',
    };
    const result = await dynamicLoadingSchemaService(credentialConfig);
    expect(result).toEqual('Version is required for local schema loading');
  });

  const version = 'v1.0.0';
  it('should throw an error if the schema is not found', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(false);
    const credentialConfig = {
      type: schema,
      version: version,
      url: '',
      dataPath: '/path/to/schema',
    };
    const result = await dynamicLoadingSchemaService(credentialConfig);
    expect(result).toEqual('Schema not found');
    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(0);
  });

  it('should throw an error if the version is not found', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(true);
    (checkSchemaVersionExists as jest.Mock).mockResolvedValue(false);
    const credentialConfig = {
      type: schema,
      version: version,
      url: '',
      dataPath: '/path/to/schema',
    };

    const result = await dynamicLoadingSchemaService(credentialConfig);
    expect(result).toEqual('Version not found for schema event');
    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if the schema content is not found', async () => {
    (checkSchemaExists as jest.Mock).mockResolvedValue(true);
    (checkSchemaVersionExists as jest.Mock).mockResolvedValue(true);
    (getSchemaContent as jest.Mock).mockResolvedValue('');
    const credentialConfig = {
      type: schema,
      version: version,
      url: '',
      dataPath: '/path/to/schema',
    };

    const result = await dynamicLoadingSchemaService(credentialConfig);
    expect(result).toEqual('Content in event schema not found');
    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(1);
    expect(getSchemaContent).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if an error occurs', async () => {
    const expectedError = new Error('Schema not found');
    (checkSchemaExists as jest.Mock).mockRejectedValue(expectedError);
    const credentialConfig = {
      type: schema,
      version: version,
      url: '',
      dataPath: '/path/to/schema',
    };
    const result = await dynamicLoadingSchemaService(credentialConfig);
    expect(result).toEqual('Schema not found');
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
    const result = await dynamicLoadingSchemaService({ type: schema, version });

    expect(checkSchemaExists).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersionExists).toHaveBeenCalledTimes(1);
    expect(getSchemaContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual(content);
  });
});
