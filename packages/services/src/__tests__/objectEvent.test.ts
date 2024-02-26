import { processObjectEvent } from '../../build/epcisEvents/objectEvent';
import { issueVC, contextDefault } from '../../build/vckit.service';
import { uploadJson } from '../../build/storage.service';
import { registerLinkResolver, IdentificationKeyType } from '../../build/linkResolver.service';
import { contextObjectEvent, dataObjectEvent } from './mocks/constants';

jest.mock('../../build/vckit.service', () => ({
  issueVC: jest.fn(),
  contextDefault: ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
}));

jest.mock('../../build/storage.service', () => ({
  uploadJson: jest.fn(),
}));

jest.mock('../../build/linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  IdentificationKeyType: {
    gtin: 'gtin',
    nlisid: 'nlisid',
  },
}));

describe('processObjectEvent', () => {
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
          render: value.render,
        };

        return Promise.resolve(expectVCResult);
      });
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should call process object event', async () => {
      (uploadJson as jest.Mock).mockImplementation(({ filename, bucket }: { filename: string; bucket: string }) => {
        return `https://${bucket}.s3.ap-southeast-2.amazonaws.com/${filename}`;
      });

      (registerLinkResolver as jest.Mock).mockImplementation(
        (
          url,
          identificationKeyType: IdentificationKeyType,
          identificationKey: string,
          linkTitle,
          verificationPage,
          dlrAPIUrl: string,
          dlrAPIKey,
        ) => {
          console.log({
            url,
            linkTitle,
            verificationPage,
            dlrAPIKey,
            identificationKey,
          });
          return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
        },
      );

      const vc = await processObjectEvent(dataObjectEvent, contextObjectEvent);
      expect(vc).toEqual(expectVCResult);
      expect(uploadJson).toHaveBeenCalledWith({
        filename: expect.any(String),
        json: expectVCResult,
        bucket: contextObjectEvent.storage.bucket,
        storageAPIUrl: contextObjectEvent.storage.storageAPIUrl,
      });

      expect(registerLinkResolver).toHaveBeenCalled();

      const dppContext = contextObjectEvent.dpp;
      const dlrContext = contextObjectEvent.dlr;
      expect(registerLinkResolver).toHaveBeenCalledWith(
        expect.any(String),
        dppContext.dlrIdentificationKeyType,
        dataObjectEvent.data.herd.NLIS,
        dppContext.dlrLinkTitle,
        dppContext.dlrVerificationPage,
        dlrContext.dlrAPIUrl,
        dlrContext.dlrAPIKey,
      );
    });
  });

  describe('error case', () => {
    afterEach(() => {
      jest.clearAllMocks();
      jest.resetAllMocks;
    });

    it('should throw error when data is empty', async () => {
      try {
        await processObjectEvent({ data: { herd: '' } }, contextObjectEvent);
      } catch (error) {
        expect(error.message).toEqual('Identifier not found');
      }
    });

    it('should throw error when context is empty', async () => {
      const newContext = {
        vckit: {},
        dpp: {},
        dlr: {},
        storage: {},
        identifierKeyPaths: [],
      };
      try {
        await processObjectEvent(dataObjectEvent, newContext);
      } catch (error) {
        console.log(error.message);
        expect(error.message).not.toBeNull();
      }
    });

    it('should throw error when context is empty identifierKeyPaths field', async () => {
      (issueVC as jest.Mock).mockResolvedValue({});

      const newContext = {
        ...contextObjectEvent,
        identifierKeyPaths: [],
      };
      try {
        await processObjectEvent(dataObjectEvent, newContext);
      } catch (error) {
        expect(error.message).toEqual('Identifier not found');
      }
    });

    it('should throw error when context is empty vckit field', async () => {
      (issueVC as jest.Mock).mockImplementation((value) => {
        return Promise.reject(new Error('Invalid vckit context'));
      });

      const newContext = {
        ...contextObjectEvent,
        vckit: {},
      };

      try {
        await processObjectEvent(dataObjectEvent, newContext);
      } catch (error) {
        expect(error.message).toEqual('Invalid vckit context');
      }
    });

    it('should throw error when context is empty dpp field', async () => {
      (issueVC as jest.Mock).mockImplementation((value) => {
        return Promise.reject(new Error('Invalid dpp context'));
      });

      const newContext = {
        ...contextObjectEvent,
        dpp: {},
      };

      try {
        await processObjectEvent(dataObjectEvent, newContext);
      } catch (error) {
        expect(error.message).toEqual('Invalid dpp context');
      }
    });

    it('should throw error when context is empty storage field', async () => {
      (issueVC as jest.Mock).mockResolvedValue({});

      (uploadJson as jest.Mock).mockRejectedValue(new Error('Invalid storage context'));

      const newContext = {
        ...contextObjectEvent,
        storage: {},
      };

      try {
        await processObjectEvent(dataObjectEvent, newContext);
      } catch (error) {
        expect(error.message).toEqual('Invalid storage context');
      }
    });

    it('should throw error when context is empty dlr field', async () => {
      (issueVC as jest.Mock).mockResolvedValue({});
      (uploadJson as jest.Mock).mockResolvedValue(
        'https://test-verifiable-credentials.s3.ap-southeast-2.amazonaws.com/1234',
      );

      (registerLinkResolver as jest.Mock).mockRejectedValue(new Error('Invalid dlr context'));

      const newContext = {
        ...contextObjectEvent,
        dlr: {},
      };
      try {
        await processObjectEvent(dataObjectEvent, newContext);
      } catch (error) {
        expect(error.message).toEqual('Invalid dlr context');
      }
    });
  });
});
