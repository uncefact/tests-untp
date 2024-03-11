import {
  loadingConfigContentServices,
  loadingDataPath,
} from '../../src/core/services/loading-config-content/loadingConfigContent.service';
import { hasErrors } from '../../src/core/services/json-schema/validator.service';
import { processTestRunner } from '../../src/core/process-test-suite';
import { dynamicLoadingSchemaService } from '../../src/core/services/dynamic-loading-schemas/loadingSchema.service';

jest.mock('../../src/core/services/loading-config-content/loadingConfigContent.service', () => ({
  loadingConfigContentServices: jest.fn(),
  loadingDataPath: jest.fn(),
}));

jest.mock('../../src/core/services/dynamic-loading-schemas/loadingSchema.service', () => ({
  dynamicLoadingSchemaService: jest.fn(),
}));

jest.mock('../../src/core/services/json-schema/validator.service', () => ({
  hasErrors: jest.fn(),
}));

describe('processTestRunner', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return an array of error objects', async () => {
    const mockConfigContent = [
      {
        dataPath: 'dataPath',
        type: 'schema',
        version: 'v1.0.0',
      },
    ];

    const mockSchema = {
      schema: 'schema',
      data: 'data',
    };

    (loadingConfigContentServices as jest.Mock).mockResolvedValue(mockConfigContent);
    (dynamicLoadingSchemaService as jest.Mock).mockResolvedValue(mockSchema);
    (loadingDataPath as jest.Mock).mockResolvedValue(mockSchema.data);
    (hasErrors as jest.Mock).mockReturnValue(null);

    const result = await processTestRunner();
    expect(result).toEqual([null]);
  });

  it('should throw error when loadingSchema is null', async () => {
    const error = new Error('loadingSchema is null');
    (loadingConfigContentServices as jest.Mock).mockResolvedValue(null);
  });
});
