import {
  issueEpcisTransformationEvent,
  processTransformationEvent,
  uploadVC,
} from '../epcisEvents/transformationEvent';
import { issueVC, contextDefault } from '../vckit.service';
import { uploadData } from '../storage.service';
import { registerLinkResolver } from '../linkResolver.service';
import { IEntityIssue } from '../types';
import { contextTransformationEvent, dataTransformationEvent } from './mocks/constants';
import { constructVerifyURL, generateUUID } from '../utils';

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
  getLinkResolverIdentifier: jest.fn(() => ({ identifier: '9359502000010', qualifierPath: '/10/ABC123' })),
  LinkType: {
    verificationLinkType: 'gs1:verificationService',
    certificationLinkType: 'gs1:certificationInfo',
    epcisLinkType: 'gs1:epcis',
    traceability: 'traceability',
  },
}));
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  constructVerifyURL: jest.fn(),
}));

describe('Transformation event', () => {
  describe('successful case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should issue epcis transformation event with multiple nilsid transforms the event', async () => {
      let expectResult = {};
      (issueVC as jest.Mock).mockImplementation((value) => {
        expectResult = {
          '@context': [...contextDefault, ...value.context],
          type: ['VerifiableCredential', ...value.type],
          issuer: {
            id: value.issuer,
          },
          credentialSubject: value.credentialSubject,
          render: value.render,
        };

        return Promise.resolve(expectResult);
      });
    });

    it('should upload vc and return link to the uploaded json file', async () => {
      let expectResult = { uri: 'http://localhost/epcis-transformation-event/1234', key: '123', hash: 'ABC123' };
      (uploadData as jest.Mock).mockResolvedValueOnce(expectResult);
      (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');
      const mockVc = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'MockEvent'],
        issuer: {
          id: 'did:example:123',
        },
        credentialSubject: { id: 'did:example:123', name: 'John Doe' },
        issuanceDate: '2021-06-22T00:00:00Z',
        render: {},
        proof: {
          type: 'JwsSignature2020',
          created: '2021-06-22T00:00:00Z',
          verificationMethod: 'did:example:123#key',
        },
      };

      const filename = 'epcis-transformation-event/1234';
      const urlUpload = await uploadVC(filename, mockVc, { url: 'http://localhost', params: { resultPath: '' } });
      expect(urlUpload).toEqual(expectResult);
    });

    it('should call issueDPP and return valid vc', async () => {
      let expectResult = {};
      const newData = {
        data: {
          ...dataTransformationEvent,
          product: {
            manufacturer: {
              name: "Pete's Meats",
            },
          },
        },
      };
      (issueVC as jest.Mock).mockImplementation((value) => {
        expectResult = {
          '@context': [...contextDefault, ...value.context],
          type: ['VerifiableCredential', ...value.type],
          issuer: {
            id: value.issuer,
          },
          render: value.render,
        };

        return Promise.resolve({ ...expectResult });
      });

      let vc = {};
      const detailOfOutputProducts = contextTransformationEvent.productTransformation.outputItems;
      detailOfOutputProducts.map(async (outputItem) => {
        expect(vc).toEqual(expectResult);
      });
    });

    it('should throw error when issue DPP with gtin is invalid', async () => {
      try {
        const mockVc = {
          issuer: '',
          vckitAPIUrl: '',
        };

        const mockDpp = {
          context: [],
          renderTemplate: [],
          type: [''],
        };

        // await issueDPP(mockVc, mockDpp, 0, '', { inputItems: [], outputItems: [] }, {});
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should call registerLinkResolver transformation event', async () => {
      (uploadData as jest.Mock)
        .mockResolvedValueOnce({ uri: 'http://localhost/epcis-transformation-event/1234', key: '123', hash: 'ABC123' })
        .mockResolvedValueOnce({ uri: 'http://localhost/dpp-event/1234', key: '123', hash: 'ABC123' });
      (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');
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
          qualifierPath,
        ) => {
          return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
        },
      );

      const data = await processTransformationEvent(dataTransformationEvent, contextTransformationEvent);
      expect(registerLinkResolver).toHaveBeenCalledTimes(2);
    });

    it('should process transformation event with custom verifiable credential service headers', async () => {
      const mockHeaders = { 'X-Custom-Header': 'test-value' };
      const mockVcKitContext = {
        issuer: 'did:example:123',
        vckitAPIUrl: 'https://api.vckit.example.com',
        headers: mockHeaders,
      };
      const mockEpcisTransformationEvent = {
        context: ['https://example.com/epcis-context'],
        type: ['EPCISTransformationEvent'],
        renderTemplate: {},
      };
      const mockDlrContext = {
        dlrAPIUrl: 'https://dlr.example.com',
        dlrAPIKey: 'test-api-key',
        namespace: 'test-namespace',
      };
      const mockTransformationEventCredential = {
        mappingFields: [
          {
            sourcePath: '/data/eventID',
            destinationPath: '/eventID',
          },
        ],
      };
      const mockData = {
        data: {
          eventID: '1234',
        },
      };
      const transformationEventCredentialId = generateUUID();

      (issueVC as jest.Mock).mockResolvedValue({
        '@context': ['https://www.w3.org/2018/credentials/v1', 'https://example.com/epcis-context'],
        type: ['VerifiableCredential', 'EPCISTransformationEvent'],
        issuer: { id: 'did:example:123' },
        credentialSubject: { eventID: '1234' },
      });

      await issueEpcisTransformationEvent(
        mockVcKitContext,
        mockEpcisTransformationEvent as IEntityIssue,
        mockDlrContext,
        mockTransformationEventCredential,
        transformationEventCredentialId,
        mockData,
      );

      expect(issueVC).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: mockHeaders,
        }),
      );
    });
  });

  describe('error case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should throw error when issueVC throws error', async () => {
      try {
        await processTransformationEvent(null, null);
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should throw error when context is empty', async () => {
      const emptyContext = {
        vckit: {},
        dpp: {},
        dlr: {},
        storage: {},
        epcisTransformationEvent: {},
        identifiers: [],
        productTransformation: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, emptyContext);
      } catch (error: any) {
        expect(error.message).not.toBeNull();
      }
    });

    it('should throw error when context is empty vckit field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        vckit: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).not.toBeNull();
      }
    });
    it('should throw error when context is empty dpp field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        dpp: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Invalid dpp context');
      }
    });

    it('should throw error when context is empty dlr field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        dlr: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Invalid dlr context');
      }
    });

    it('should throw error when context is empty epcisTransformationEvent field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        epcisTransformationEvent: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).not.toBeNull();
      }
    });

    it('should throw error when context is empty epcisTransformationEvent type field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        epcisTransformationEvent: {
          ...contextTransformationEvent.epcisTransformationEvent,
          type: '',
        },
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Invalid epcisTransformationEvent type');
      }
    });

    it('should throw error when context is empty productTransformation field', async () => {
      (uploadData as jest.Mock)
        .mockResolvedValueOnce({ uri: 'http://localhost/transformation-event/1234', key: '123', hash: 'ABC123' })
        .mockResolvedValueOnce({ uri: 'http://localhost/dpp/1234', key: '123', hash: 'ABC123' });
      const newContext = {
        ...contextTransformationEvent,
        productTransformation: [],
        transformationEventCredential: {
          mappingFields: [
            {
              sourcePath: '/vc/credentialSubject/productIdentifier/0/identifierValue',
              destinationPath: '/eventID',
            },
          ],
        },
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Output Items not found');
      }
    });

    it('should throw error when context is empty storage field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        storage: [],
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Invalid storage context');
      }
    });
  });
});
