# Services

This directory contains the source code for the services that are used by the application, aiming to provide a clean separation of concerns.

## Example use case

```JS
class ObjectEvent extends BaseEvent {
  constructor(template, schema) {
    super(template, schema);
  }
}

const objectEvent = new ObjectEvent('object_template', 'object_schema');
await objectEvent.issueVC({
  credentialPayload: {},
  credentialSubject: {},
  issuer: '',
  restOfVC: {},
  context: {},
  vcKitAPIUrl: '',
});
```
