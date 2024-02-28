import { processTransactionEvent } from '../epcisEvents/transactionEvent';
import { issueVC, contextDefault } from '../vckit.service';
import { uploadJson } from '../storage.service';
import { registerLinkResolver, IdentificationKeyType, DLREventEnum } from '../linkResolver.service';
import { contextTransactionEvent, dataTransactionEvent } from './mocks/constants';

jest.mock('../vckit.service', () => ({
  issueVC: jest.fn(),
  contextDefault: ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
}));

jest.mock('../storage.service', () => ({
  uploadJson: jest.fn(),
}));

jest.mock('../linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  IdentificationKeyType: {
    gtin: 'gtin',
    nlisid: 'nlisid',
  },
  DLREventEnum: {
    Transformation: 'transformation',
    Object: 'object',
    Aggregation: 'aggregation',
    Transaction: 'transaction',
    Association: 'association',
  },
  EPCISEventAction: {
    Observe: 'observe',
  },
  EPCISEventDisposition: {
    InTransit: 'in_transit',
  },
}));

describe('processTransactionEvent', () => {
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

    it('should call process transaction event', async () => {
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
          event: DLREventEnum,
        ) => {
          console.log({
            url,
            linkTitle,
            verificationPage,
            dlrAPIKey,
            identificationKey,
            event,
          });
          return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
        },
      );

      const vc = await processTransactionEvent(dataTransactionEvent, contextTransactionEvent);
      expect(vc).toEqual(expectVCResult);
      expect(uploadJson).toHaveBeenCalledWith({
        filename: expect.any(String),
        json: expectVCResult,
        bucket: contextTransactionEvent.storage.bucket,
        storageAPIUrl: contextTransactionEvent.storage.storageAPIUrl,
      });

      expect(registerLinkResolver).toHaveBeenCalled();

      const dppContext = contextTransactionEvent.dpp;
      const dlrContext = contextTransactionEvent.dlr;
      expect(registerLinkResolver).toHaveBeenCalledWith(
        expect.any(String),
        dppContext.dlrIdentificationKeyType,
        dataTransactionEvent.data.livestockIds[0],
        dppContext.dlrLinkTitle,
        dppContext.dlrVerificationPage,
        dlrContext.dlrAPIUrl,
        dlrContext.dlrAPIKey,
        DLREventEnum.Transaction,
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
        await processTransactionEvent({ data: { livestockIds: [] } }, contextTransactionEvent);
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
        identifierKeyPaths: [],
      };
      try {
        await processTransactionEvent(dataTransactionEvent, newContext);
      } catch (error: any) {
        console.log(error.message);
        expect(error.message).not.toBeNull();
      }
    });

    it('should throw error when context is empty identifierKeyPaths field', async () => {
      (issueVC as jest.Mock).mockResolvedValue({});

      const newContext = {
        ...contextTransactionEvent,
        identifierKeyPaths: [],
      };
      try {
        await processTransactionEvent(dataTransactionEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('identifierKeyPaths not found');
      }
    });

    it('should throw error when context is empty vckit field', async () => {
      const newContext = {
        ...contextTransactionEvent,
        vckit: {},
      };

      try {
        await processTransactionEvent(dataTransactionEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Invalid vckit context');
      }
    });

    it('should throw error when context is empty dpp field', async () => {
      const newContext = {
        ...contextTransactionEvent,
        dpp: {},
      };

      try {
        await processTransactionEvent(dataTransactionEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Invalid dpp context');
      }
    });

    it('should throw error when context is empty storage field', async () => {
      const newContext = {
        ...contextTransactionEvent,
        storage: {},
      };

      try {
        await processTransactionEvent(dataTransactionEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Invalid storage context');
      }
    });

    it('should throw error when context is empty dlr field', async () => {
      const newContext = {
        ...contextTransactionEvent,
        dlr: {},
      };
      try {
        await processTransactionEvent(dataTransactionEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Invalid dlr context');
      }
    });
  });
});
