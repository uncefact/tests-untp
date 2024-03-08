import { loadingConfigContentServices } from '../../../../src/core/services/loading-config-content/loadingConfigContent.service';
import { readConfigContent, validateConfigContent } from '../../../../src/core/services/loading-config-content/utils';

jest.mock('../../../../src/core/services/loading-data-path/utils', () => ({
  readConfigContent: jest.fn(),
  validateConfigContent: jest.fn(),
}));
describe('validateConfigValue', () => {
  const mockCredentials = {
    dataPath: 'dataPath',
    type: 'schema',
    version: 'v1.0.0',
  };
  it('should return data path', async () => {
    JSON.parse = jest.fn().mockImplementation(() => {
      return mockCredentials;
    });
    (readConfigContent as jest.Mock).mockResolvedValue(mockCredentials);
    (validateConfigContent as jest.Mock).mockReturnValue(mockCredentials);

    const result = await loadingConfigContentServices();

    expect(result).toBe(mockCredentials);
  });
});
