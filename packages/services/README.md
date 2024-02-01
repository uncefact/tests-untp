# Services

This directory contains the source code for the services that are used by the application, aiming to provide a clean separation of concerns.

## Example use case

```JS
class DummyEvent extends BaseEvent {
  constructor({ renderTemplate, context, issuer, vcKitAPIUrl, eventType }) {
    super({ renderTemplate, context, issuer, vcKitAPIUrl, eventType });
  }
}

const dummyEvent = new DummyEvent({
  renderTemplate: { template: 'template', '@type': 'type' },
  context: ['context'],
  issuer: 'issuer',
  vcKitAPIUrl: 'vcKitAPIUrl',
  eventType: 'eventType',
});

await dummyEvent.issueEvent({
  credentialPayload: { batchId: '1234' },
  credentialSubject: { id: 'did:web:localhost', name: 'John Doe', age: 30 },
  type: 'typeEvent'
});

await dummyEvent.storageEvent({
  filename: 'filename',
  bucket: BucketName.PublicVC, // enum BucketName {  PublicVC = 'PublicVCBucket' }
  json: { name: 'John', age: 30 },
  typeBucket: { PublicVC: 'bucket-verifiable-credentials' },
  storageAPIUrl: 'https://storage.com',
  typeStorage: 'S3',
});

```
