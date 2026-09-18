import { credentialBatchRequestSchema } from './credential-batch';

const item = {
  credentialPayload: { issuer: { id: 'did:web:issuer.example' } },
  credentialType: 'DigitalProductPassport',
  version: '0.6.0',
};

describe('credentialBatchRequestSchema', () => {
  it('reuses the single issuance item shape and requires a non-empty array', () => {
    expect(credentialBatchRequestSchema.parse({ items: [item] })).toEqual({ items: [item] });
    expect(() => credentialBatchRequestSchema.parse({ items: [] })).toThrow('must contain at least one item');
    expect(() => credentialBatchRequestSchema.parse({ items: [{ ...item, version: '' }] })).toThrow('version');
  });

  it('keeps document and DID ownership checks outside the batch shape boundary', () => {
    expect(credentialBatchRequestSchema.parse({ items: [{ ...item, credentialPayload: {} }] })).toEqual({
      items: [{ ...item, credentialPayload: {} }],
    });
  });
});
