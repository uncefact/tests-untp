import { detectVcdmVersion, downloadHtml, downloadJson, isPermittedCredentialType, readTemplate } from '@/lib/utils';
import { CredentialType, VCDM_CONTEXT_URLS, VCDMVersion } from '../../constants';
import { reportTemplates } from '@/types/templates';

describe('utils', () => {
  beforeAll(() => {
    URL.createObjectURL = jest.fn().mockReturnValue('blob-url');
    URL.revokeObjectURL = jest.fn();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('detectVcdmVersion', () => {
    it('should detect VCDM v1 version', () => {
      const credential = {
        '@context': [VCDM_CONTEXT_URLS.v1],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.V1);
    });

    it('should detect VCDM v2 version', () => {
      const credential = {
        '@context': [VCDM_CONTEXT_URLS.v2],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.V2);
    });

    it('should return UNKNOWN for null credential', () => {
      const result = detectVcdmVersion(null as any);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN for undefined credential', () => {
      const result = detectVcdmVersion(undefined as any);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN when @context is missing', () => {
      const credential = {
        type: ['VerifiableCredential'],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN when @context is not an array', () => {
      const credential = {
        '@context': 'https://www.w3.org/2018/credentials/v1',
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN when @context array is empty', () => {
      const credential = {
        '@context': [],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN for unrecognized context URL', () => {
      const credential = {
        '@context': ['https://unknown.context.url'],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should detect version based on first context URL only', () => {
      const credential = {
        '@context': [
          VCDM_CONTEXT_URLS.v1,
          'https://w3id.org/security/suites/jws-2020/v1',
          VCDM_CONTEXT_URLS.v2, // This should be ignored
        ],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.V1);
    });
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

    it('should throw an error if readTemplate fails', async () => {
      const data = { name: 'John Doe' };
      const filename = 'report';
      const templateName = 'invalid-name';

      await expect(downloadHtml(data, filename, templateName)).rejects.toThrow('Failed to download HTML report');
    });
  });

  describe('readTemplate', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('reads the correct template file and returns its content', async () => {
      const templateName = 'UNTP_REPORT';
      const result = await readTemplate(templateName);
      expect(result).toBe(reportTemplates[templateName]);
    });

    it('throws an error if reading the file fails', async () => {
      const templateName = 'invalid-name';
      const errorMessage = `Template \"${templateName}"\ not found`;
      await expect(readTemplate(templateName)).rejects.toThrow(errorMessage);
    });
  });
});
