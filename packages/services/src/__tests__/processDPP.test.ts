import { processDPP } from '../processDPP.service';
import { issueVC, contextDefault, decodeEnvelopedVC } from '../vckit.service';
import { uploadData } from '../storage.service';
import { registerLinkResolver, LinkType } from '../linkResolver.service';
import * as identifierSchemeServices from '../identifierSchemes/identifierSchemeServices';
import { contextDPP, dataDPP } from './mocks/constants';
import { constructVerifyURL } from '../utils/helpers';

jest.mock('../vckit.service', () => ({
  issueVC: jest.fn(),
  decodeEnvelopedVC: jest.fn(),
  contextDefault: ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
}));

jest.mock('../storage.service', () => ({
  uploadData: jest.fn(),
}));

jest.mock('../linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  LinkType: {
    verificationLinkType: 'gs1:verificationService',
    certificationLinkType: 'gs1:certificationInfo',
    epcisLinkType: 'gs1:epcis',
    sustainabilityInfo: 'sustainabilityInfo',
  },
}));
jest.mock('../utils/helpers', () => ({
  ...jest.requireActual('../utils/helpers'),
  constructVerifyURL: jest.fn(),
}));

describe('processDPP', () => {
  describe('successful case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    let expectVCResult = {};
    beforeAll(() => {
      (issueVC as jest.Mock).mockImplementation((value) => {
        expectVCResult = {
          '@context': [...contextDefault, ...value.context],
          type: ['VerifiableCredential', ...value.type],
          issuer: {
            id: value.issuer,
          },
          credentialSubject: value.credentialSubject,
          renderMethod: value.render,
        };

        return Promise.resolve(expectVCResult);
      });

      (decodeEnvelopedVC as jest.Mock).mockReturnValue({
        credentialSubject: { id: 'https://example.com/123' },
      });
    });

    it('should call process DPP', async () => {
      const mockVerifyURL = 'https://example.com/vc.json';
      (uploadData as jest.Mock).mockResolvedValueOnce({
        uri: 'https://exampleStorage.com/vc.json',
        key: '123',
        hash: 'ABC123',
      });
      (constructVerifyURL as jest.Mock).mockReturnValueOnce(mockVerifyURL);

      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '9359502000010' },
        qualifiers: [
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');

      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '9359502000010' },
        qualifiers: [
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');

      (registerLinkResolver as jest.Mock).mockImplementation(
        (
          url,
          verifyURL,
          identificationKeyType: string,
          identificationKey: string,
          linkTitle,
          verificationPage,
          dlrAPIUrl: string,
          dlrAPIKey,
        ) => {
          return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
        },
      );

      const vc = await processDPP(dataDPP, contextDPP);
      expect(vc).toEqual({
        vc: expectVCResult,
        decodedEnvelopedVC: {
          credentialSubject: { id: 'https://example.com/123' },
        },
        linkResolver: 'https://web.example.com/verify/01/9359502000010?linkType=all',
      });
      expect(uploadData).toHaveBeenCalled();
      expect(registerLinkResolver).toHaveBeenCalled();

      const dppContext = contextDPP.dpp;
      const dlrContext = contextDPP.dlr;
      expect(registerLinkResolver).toHaveBeenCalledWith(
        expect.any(String),
        mockVerifyURL,
        '01',
        dataDPP.data.herd.identifier,
        dppContext.dlrLinkTitle,
        LinkType.sustainabilityInfo,
        dppContext.dlrVerificationPage,
        dlrContext.dlrAPIUrl,
        dlrContext.linkRegisterPath,
        dlrContext.dlrAPIKey,
        dlrContext.namespace,
        dataDPP.qualifierPath,
        LinkType.sustainabilityInfo,
      );
    });

    it('should call process DPP with validUntil', async () => {
      (uploadData as jest.Mock).mockImplementation(({ url, _data, path }) => {
        return `${url}/${dataDPP.data.herd.identifier}`;
      });

      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '9359502000010' },
        qualifiers: [
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');

      (registerLinkResolver as jest.Mock).mockImplementation(
        (
          url,
          identificationKeyType: string,
          identificationKey: string,
          linkTitle,
          verificationPage,
          dlrAPIUrl: string,
          dlrAPIKey,
        ) => {
          return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
        },
      );

      const newContext = {
        ...contextDPP,
        dpp: { ...contextDPP.dpp, validUntil: '2025-12-31T23:59:59Z' },
      };
      await processDPP(dataDPP, newContext);
      expect(uploadData).toHaveBeenCalled();
      expect(registerLinkResolver).toHaveBeenCalled();

      expect(issueVC).toHaveBeenCalledWith(
        expect.objectContaining({
          restOfVC: expect.objectContaining({
            validUntil: '2025-12-31T23:59:59Z',
          }),
        }),
      );
    });

    it('should process DPP with custom verifiable credential service headers', async () => {
      const customHeaders = { 'X-Custom-Header': 'test-value' };
      const contextWithHeaders = {
        ...contextDPP,
        vckit: {
          ...contextDPP.vckit,
          headers: customHeaders,
        },
      };

      (uploadData as jest.Mock).mockResolvedValueOnce({
        uri: 'https://exampleStorage.com/vc.json',
        key: '123',
        hash: 'ABC123',
      });
      (constructVerifyURL as jest.Mock).mockReturnValueOnce('https://example.com/vc.json');

      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '0123456789' },
        qualifiers: [],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/');

      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '0123456789' },
        qualifiers: [],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/');

      (registerLinkResolver as jest.Mock).mockImplementation(
        (
          url,
          verifyURL,
          identificationKeyType: string,
          identificationKey: string,
          linkTitle,
          verificationPage,
          dlrAPIUrl: string,
          dlrAPIKey,
        ) => {
          return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
        },
      );

      const vc = await processDPP(dataDPP, contextWithHeaders);

      expect(vc).toEqual({
        vc: expectVCResult,
        decodedEnvelopedVC: {
          credentialSubject: { id: 'https://example.com/123' },
        },
        linkResolver: expect.any(String),
      });

      expect(issueVC).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: customHeaders,
        }),
      );

      expect(uploadData).toHaveBeenCalled();
      expect(registerLinkResolver).toHaveBeenCalled();
    });
  });

  describe('error case', () => {
    afterEach(() => {
      jest.clearAllMocks();
      jest.resetAllMocks();
    });

    it('should throw error when data is empty', async () => {
      try {
        jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
          primary: { ai: '', value: '' },
          qualifiers: [],
        });

        await processDPP({ data: { herd: '' } }, contextDPP);
      } catch (error: any) {
        expect(error.message).toEqual('Identifier not found');
      }
    });

    it('should throw error when context is empty', async () => {
      const newContext = {
        vckit: {},
        dpp: {},
        dlr: {},
        storage: {},
        identifierKeyPath: '',
      };
      try {
        await processDPP(dataDPP, newContext);
      } catch (error: any) {
        expect(error.message).not.toBeNull();
      }
    });

    it('should throw error when context is empty identifierKeyPath field', async () => {
      (issueVC as jest.Mock).mockResolvedValue({});

      const newContext = {
        ...contextDPP,
        identifierKeyPath: '',
      };
      try {
        await processDPP(dataDPP, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('identifierKeyPath not found');
      }
    });

    it('should throw error when context is empty vckit field', async () => {
      const newContext = {
        ...contextDPP,
        vckit: {},
      };

      try {
        await processDPP(dataDPP, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Invalid vckit context');
      }
    });

    it('should throw error when context is empty dpp field', async () => {
      const newContext = {
        ...contextDPP,
        dpp: {},
      };

      try {
        await processDPP(dataDPP, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Invalid dpp context');
      }
    });

    it('should throw error when context is empty storage field', async () => {
      const newContext = {
        ...contextDPP,
        storage: {},
      };

      try {
        await processDPP(dataDPP, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Invalid storage context');
      }
    });

    it('should throw error when context is empty dlr field', async () => {
      const newContext = {
        ...contextDPP,
        dlr: {},
      };
      try {
        await processDPP(dataDPP, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Invalid dlr context');
      }
    });
  });
});
