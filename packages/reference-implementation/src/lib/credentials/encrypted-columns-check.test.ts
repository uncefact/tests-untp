import { encryptedColumnMismatch, taggedEncryptedColumns } from './encrypted-columns-check';

const dmmf = {
  datamodel: {
    models: [
      {
        name: 'ServiceInstance',
        fields: [
          { name: 'id' },
          { name: 'config', documentation: '@encryptedAtRest AES-256-GCM envelope of the adapter configuration JSON.' },
        ],
      },
      {
        name: 'Credential',
        fields: [{ name: 'decryptionKey', documentation: 'plain comment\n@encryptedAtRest more' }],
      },
      { name: 'Tenant', fields: [{ name: 'name', documentation: 'not encrypted' }] },
    ],
  },
};

describe('encrypted column check', () => {
  it('reads the tagged columns from the field documentation', () => {
    expect(taggedEncryptedColumns(dmmf)).toEqual(['ServiceInstance.config', 'Credential.decryptionKey']);
  });

  it('is satisfied when the adapted set equals the tagged set, whatever the order', () => {
    expect(encryptedColumnMismatch(dmmf, ['Credential.decryptionKey', 'ServiceInstance.config'])).toBeNull();
  });

  it('names a tagged column no store adapts, and an adapted column the schema does not tag', () => {
    expect(encryptedColumnMismatch(dmmf, ['ServiceInstance.config', 'IdempotencyKey.responseBody'])).toEqual({
      unadapted: ['Credential.decryptionKey'],
      untagged: ['IdempotencyKey.responseBody'],
    });
  });
});
