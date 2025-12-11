import {
  downloadJson,
  isPermittedCredentialType,
  validateNormalizedCredential,
  downloadHtml,
} from '@/lib/utils';
import { CredentialType } from '../../constants';

describe('utils', () => {
  beforeAll(() => {
    URL.createObjectURL = jest.fn().mockReturnValue('blob-url');
    URL.revokeObjectURL = jest.fn();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });



  describe('isPermittedCredentialType', () => {
    it('returns true for valid credential types', () => {
      expect(isPermittedCredentialType(CredentialType.DIGITAL_PRODUCT_PASSPORT)).toBeTruthy();
      expect(isPermittedCredentialType(CredentialType.DIGITAL_CONFORMITY_CREDENTIAL)).toBeTruthy();
      expect(isPermittedCredentialType(CredentialType.DIGITAL_FACILITY_RECORD)).toBeTruthy();
    });

    it('returns false for invalid credential types', () => {
      expect(isPermittedCredentialType('InvalidType' as CredentialType)).toBeFalsy();
      expect(isPermittedCredentialType('' as CredentialType)).toBeFalsy();
      expect(isPermittedCredentialType('Random' as CredentialType)).toBeFalsy();
    });

    it('returns false for undefined or null', () => {
      expect(isPermittedCredentialType(undefined as any)).toBeFalsy();
      expect(isPermittedCredentialType(null as any)).toBeFalsy();
    });

    it('handles case sensitivity', () => {
      expect(isPermittedCredentialType('digitalproductpassport' as CredentialType)).toBeFalsy();
      expect(isPermittedCredentialType('DIGITALPRODUCTPASSPORT' as CredentialType)).toBeFalsy();
    });
  });

  describe('downloadJson', () => {
    let mockAnchor: { href: string; download: string; click: jest.Mock; remove: jest.Mock };
    let mockCreateElement: jest.SpyInstance;
    let mockAppendChild: jest.SpyInstance;
    let mockRemoveChild: jest.SpyInstance;

    beforeEach(() => {
      mockAnchor = {
        href: '',
        download: '',
        click: jest.fn(),
        remove: jest.fn(),
      };

      mockCreateElement = jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
      mockAppendChild = jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      mockRemoveChild = jest.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      global.Blob = jest.fn().mockImplementation((content) => ({
        size: content[0].length,
        type: 'application/json',
      }));
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('downloads JSON data with correct filename', () => {
      const data = { test: 'data' };
      const filename = 'test-file';

      downloadJson(data, filename);

      expect(mockCreateElement).toHaveBeenCalledWith('a');
      expect(mockAnchor.download).toBe('test-file.json');
      expect(mockAnchor.href).toBe('blob-url');
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(mockAppendChild).toHaveBeenCalled();
      expect(mockRemoveChild).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob-url');
    });

    it('appends .json extension if not provided', () => {
      const data = { test: 'data' };
      downloadJson(data, 'test-file');
      expect(mockAnchor.download).toBe('test-file.json');
    });

    it('does not append .json if already present', () => {
      const data = { test: 'data' };
      downloadJson(data, 'test-file.json');
      expect(mockAnchor.download).toBe('test-file.json');
    });

    it('throws error for non-serializable data', () => {
      const circularData = { self: {} };
      circularData.self = circularData;

      expect(() => downloadJson(circularData, 'test-file')).toThrow('Data is not JSON-serializable');
    });
  });

  describe('downloadHtml', () => {
    let mockAnchor: { href: string; download: string; click: jest.Mock; remove: jest.Mock };
    let mockCreateElement: jest.SpyInstance;
    let mockAppendChild: jest.SpyInstance;
    let mockRemoveChild: jest.SpyInstance;
    beforeEach(() => {
      mockAnchor = {
        href: '',
        download: '',
        click: jest.fn(),
        remove: jest.fn(),
      };
      mockCreateElement = jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
      mockAppendChild = jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      mockRemoveChild = jest.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      global.Blob = jest.fn().mockImplementation((content) => ({
        size: content[0].length,
        type: 'text/html',
      }));
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    const runTest = async (filename: string, expectedFilename: string) => {
      const data = { name: 'John Doe' };
      await downloadHtml(data, filename);
      expect(mockAnchor.download).toBe(expectedFilename);
    };

    it('appends .html to the filename if not present', async () => {
      await runTest('report', 'report.html');
    });

    it('does not append .html to the filename if already present', async () => {
      await runTest('report.html', 'report.html');
    });

    it('should download HTML file with correct content', async () => {
      const mockReport = {
        implementation: { name: 'Test Implementation' },
        results: [],
        date: new Date().toISOString(),
        testSuite: {
          runner: 'UNTP Playground',
          version: '1.0.0',
        },
        pass: true,
      };
      const filename = 'report';
      await downloadHtml(mockReport, filename);
      expect(mockAnchor.download).toBe('report.html');
    });
  });
});

describe('validateNormalizedCredential', () => {
  it('should return an error when normalizedCredential is an array', () => {
    const normalizedCredential = [1, 2, 3];
    const result = validateNormalizedCredential(normalizedCredential);
    expect(result).toEqual({
      keyword: 'type',
      instancePath: 'array',
      params: {
        type: 'object',
        receivedValue: normalizedCredential,
        solution: 'Instead of [credential1, credential2], upload credential1.json and credential2.json.',
      },
      message: 'Credentials must be uploaded as separate files, not as an array.',
    });
  });

  it('should return an error when normalizedCredential is not an object', () => {
    const normalizedCredential = 'invalid';
    const result = validateNormalizedCredential(normalizedCredential);
    expect(result).toEqual({
      keyword: 'type',
      instancePath: 'invalid',
      params: {
        type: 'object',
        receivedValue: normalizedCredential,
        solution: 'Upload a valid credential file.',
      },
      message: 'Invalid credential file.',
    });
  });

  it('should return null when normalizedCredential is a valid object', () => {
    const normalizedCredential = { type: 'VerifiableCredential' };
    const result = validateNormalizedCredential(normalizedCredential);
    expect(result).toBeNull();
  });
});
