import { dynamicLoadingSchemaService } from '../../../../src/core/services/dynamic-loading-schemas/loadingSchema.service';
import * as schemas from '../../../../src/schemas';

jest.mock('../../../../src/schemas', () => ({
  getSchemasName: jest.fn(),
  getSchemasTypeAndVersion: jest.fn(),
  getContentSchema: jest.fn(),
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
    jest.spyOn(schemas, 'getSchemasName').mockResolvedValue([schema]);
    await expect(dynamicLoadingSchemaService(schema, '')).rejects.toThrow('Version not found for schema ' + schema);
  });

  const version = 'v1.0.0';
  it('should return the content of the schema', async () => {
    const content = { content: 'content' };
    const getSchemasNameSpy = jest.spyOn(schemas, 'getSchemasName').mockResolvedValue([schema]);
    const getSchemasTypeAndVersionSpy = jest
      .spyOn(schemas, 'getSchemasTypeAndVersion')
      .mockResolvedValue({ [schema]: { version: [version] } });
    const getContentSchemaSpy = jest.spyOn(schemas, 'getContentSchema').mockResolvedValue(content);

    const result = await dynamicLoadingSchemaService(schema, version);

    expect(getSchemasNameSpy).toHaveBeenCalledTimes(1);
    expect(getSchemasTypeAndVersionSpy).toHaveBeenCalledTimes(1);
    expect(getContentSchemaSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(content);
  });

  it('should throw an error if the schema is not found', async () => {
    const getSchemasNameSpy = jest.spyOn(schemas, 'getSchemasName').mockResolvedValue([]);
    const getSchemasTypeAndVersionSpy = jest.spyOn(schemas, 'getSchemasTypeAndVersion').mockResolvedValue({});

    await expect(dynamicLoadingSchemaService(schema, version)).rejects.toThrow(`Schema not found`);
    expect(getSchemasNameSpy).toHaveBeenCalledTimes(1);
    expect(getSchemasTypeAndVersionSpy).toHaveBeenCalledTimes(0);
  });

  it('should throw an error if the version is not found', async () => {
    const getSchemasNameSpy = jest.spyOn(schemas, 'getSchemasName').mockResolvedValue([schema]);
    const getSchemasTypeAndVersionSpy = jest
      .spyOn(schemas, 'getSchemasTypeAndVersion')
      .mockResolvedValue({ [schema]: { version: [] } });

    await expect(dynamicLoadingSchemaService(schema, version)).rejects.toThrow(
      `Version not found for schema ${schema}`,
    );
    expect(getSchemasNameSpy).toHaveBeenCalledTimes(1);
    expect(getSchemasTypeAndVersionSpy).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if the schema content is not found', async () => {
    const getSchemasNameSpy = jest.spyOn(schemas, 'getSchemasName').mockResolvedValue([schema]);
    const getSchemasTypeAndVersionSpy = jest
      .spyOn(schemas, 'getSchemasTypeAndVersion')
      .mockResolvedValue({ [schema]: { version: [version] } });
    const getContentSchemaSpy = jest.spyOn(schemas, 'getContentSchema').mockResolvedValue(null);

    await expect(dynamicLoadingSchemaService(schema, version)).rejects.toThrow(`Content in ${schema} schema not found`);
    expect(getSchemasNameSpy).toHaveBeenCalledTimes(1);
    expect(getSchemasTypeAndVersionSpy).toHaveBeenCalledTimes(1);
    expect(getContentSchemaSpy).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if an error occurs', async () => {
    const getSchemasNameSpy = jest.spyOn(schemas, 'getSchemasName').mockRejectedValue({});

    await expect(dynamicLoadingSchemaService(schema, version)).rejects.toThrow('Error loading schema');
    expect(getSchemasNameSpy).toHaveBeenCalledTimes(1);
  });
});
