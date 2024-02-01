import { BaseEvent } from '../models/BaseEvent';
import { BucketName, uploadJson } from '../storage.service';
import { integrateVckitIssueVC } from '../vckit.service';

jest.mock('../vckit.service', () => ({
  integrateVckitIssueVC: jest.fn(),
}));

jest.mock('../storage.service', () => ({
  uploadJson: jest.fn(),
  BucketName: {
    PublicVC: 'PublicVCBucket',
    PrivateVC: 'PrivateVCBucket',
    EPCISEvent: 'EPCISEventBucket',
  },
}));

class DummyEvent extends BaseEvent {}

describe('BaseEvent', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  let instance: DummyEvent;
  describe('create instance with type and url params in constructor', () => {
    beforeAll(() => {
      instance = new DummyEvent({ eventType: 'dummy_event', vcKitAPIUrl: 'http://localhost:3000', issuer: 'issuer' });
    });

    it('should create an instance of BaseEvent', () => {
      expect(instance).toBeInstanceOf(DummyEvent);
    });

    it('should have eventType property', () => {
      expect(instance.eventType).toEqual('dummy_event');
    });

    it('should have vcKitAPIUrl property', () => {
      expect(instance.vcKitAPIUrl).toEqual('http://localhost:3000');
    });

    it('should have issuer property', () => {
      expect(instance.issuer).toEqual('issuer');
    });

    it('should have renderTemplate property', () => {
      expect(instance.renderTemplate).toBeUndefined();
    });
  });

  describe('create instance with all params in constructor and call method', () => {
    beforeAll(() => {
      instance = new DummyEvent({
        eventType: 'dummy_event',
        vcKitAPIUrl: 'http://localhost:3000',
        renderTemplate: {
          render: [
            {
              template: 'template',
              '@type': 'type',
            },
          ],
        },
        context: ['context'],
        issuer: 'issuer',
      });
    });

    it('should have renderTemplate property', () => {
      expect(instance.renderTemplate).toEqual({ render: [{ '@type': 'type', template: 'template' }] });
    });

    describe('issueEvent', () => {
      it('should return successful value from integrateVckitIssueVC when calling issueVC with valid params', async () => {
        const mockResult = { data: 'successful' };
        (integrateVckitIssueVC as jest.Mock).mockResolvedValueOnce(mockResult);
        const result = await instance.issueEvent({
          credentialPayload: { batchId: '1234' },
          credentialSubject: {
            id: 'did:web:localhost',
            name: 'John Doe',
            age: 30,
          },
          type: 'dummy_event',
        });
        expect(result).toEqual(mockResult);
      });

      it('should throw error from integrateVckitIssueVC when call issueVC with invalid params', async () => {
        try {
          (integrateVckitIssueVC as jest.Mock).mockRejectedValueOnce(new Error('error'));
          await instance.issueEvent({
            credentialPayload: {},
            credentialSubject: {},
          });
        } catch (error) {
          expect(error.message).toEqual('error');
        }
      });
    }); // end of issueEvent

    describe('storageEvent', () => {
      const arg = {
        filename: 'test',
        bucket: BucketName.PrivateVC,
        json: {
          name: 'John',
          age: 30,
        },
        storageAPIUrl: 'https://storage.com',
        typeBucket: {
          PublicVCBucket: 'bucket-verifiable-credentials',
          PrivateVCBucket: 'bucket-verifiable-credentials',
          EPCISEventBucket: 'bucket-verifiable-credentials',
        },
        typeStorage: 'S3',
      };

      it('should return successful value from uploadJson when calling storageEvent with valid params', async () => {
        const mockResult = 'https://storage.com/test.json';
        (uploadJson as jest.Mock).mockResolvedValueOnce(mockResult);
        const result = await instance.storageEvent(arg);
        expect(result).toEqual(mockResult);
      });

      it('should throw error from uploadJson when call storageEvent with invalid params', async () => {
        try {
          const newArg = { ...arg, bucket: BucketName.PrivateVC };
          (uploadJson as jest.Mock).mockRejectedValueOnce(new Error('error'));
          await instance.storageEvent(newArg);
        } catch (error) {
          expect(error.message).toEqual('error');
        }
      });

      it('should throw error from uploadJson when call storageEvent with invalid typeStorage', async () => {
        try {
          const newArg = { ...arg, typeStorage: 'invalid' };
          await instance.storageEvent(newArg);
        } catch (error) {
          expect(error.message).toEqual('typeStorage is not defined');
        }
      });
    }); // end of storageEvent
  }); // end of create instance with all params in constructor and call method
});
