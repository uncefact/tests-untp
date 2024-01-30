import { BaseEvent } from '../models/BaseEvent';
import { integrateVckitIssueVC } from '../vckit.service';

jest.mock('../vckit.service', () => ({
  integrateVckitIssueVC: jest.fn(),
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
  });
});
