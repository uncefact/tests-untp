import { credentialBatchRequestSchema } from './credential-batch';
import { credentialBatchItemRequestSchema, credentialIssueRequestSchema } from './credential';

const item = {
  credentialPayload: { issuer: { id: 'did:web:issuer.example' } },
  credentialType: 'DigitalProductPassport',
  version: '0.7.0',
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

  it('accepts a bounded reference on batch items but not on single issuance requests', () => {
    const reference = 'a'.repeat(200);

    expect(credentialBatchItemRequestSchema.parse({ ...item, reference })).toEqual({ ...item, reference });
    expect(credentialIssueRequestSchema.parse({ ...item, reference })).toEqual(item);
  });

  it('accepts ordinary non-ASCII reference text', () => {
    const reference = 'Ref-ä-日本';

    expect(credentialBatchItemRequestSchema.parse({ ...item, reference })).toEqual({ ...item, reference });
  });

  it.each(['', 'a'.repeat(201), 'a\u0000b', 'a\u000ab', 'a\u001fb', 'a\u007fb', 'a\u0085b', 'a\u009Fb'])(
    'rejects a reference outside the batch item contract: %j',
    (reference) => {
      // Regression: an invalid reference must fail the batch item schema instead of being silently stored or stripped.
      const result = credentialBatchRequestSchema.safeParse({ items: [{ ...item, reference }] });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['items', 0, 'reference']);
    },
  );

  it("carries each item's own tags and refuses a bad item's tags at that item's path", () => {
    // Catches a regression that drops tags from batch items or reports a bad tag without naming its item.
    expect(
      credentialBatchRequestSchema.parse({ items: [{ ...item, tags: ['audit'] }, item, { ...item, tags: [] }] }),
    ).toEqual({ items: [{ ...item, tags: ['audit'] }, item, { ...item, tags: [] }] });

    const result = credentialBatchRequestSchema.safeParse({
      items: [item, { ...item, tags: ['x', 'y', 'z', 'y'] }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(['items', 1, 'tags', 3]);
      expect(result.error.issues[0].message).toBe('must not repeat a tag; duplicates items.1.tags.1');
    }
  });
});
