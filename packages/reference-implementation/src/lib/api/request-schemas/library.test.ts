import { CoreCredentialType } from '@/lib/prisma/generated';
import {
  REGISTER_DISPLAY_NAME_MAX_LENGTH,
  REGISTER_NOTES_MAX_LENGTH,
  REGISTER_SOURCE_URL_MAX_LENGTH,
  calendarDateSchema,
  registerExternalCredentialRequestSchema,
  sourceEncryptionSchema,
} from './library';

type Body = {
  sourceUrl: string;
  sourceEncryption?: { decryptionKey: string; encryptionMethod?: string };
  annotations: {
    displayName: string;
    declaredCredentialType: CoreCredentialType;
    dateReceived?: string;
    notes?: string;
  };
};

const validBody = (): Body => ({
  sourceUrl: 'https://supplier.example/credentials/abc',
  sourceEncryption: { decryptionKey: 'a'.repeat(64), encryptionMethod: 'AES-256-GCM' },
  annotations: {
    displayName: 'Battery passport from Supplier A',
    declaredCredentialType: CoreCredentialType.DPP,
    dateReceived: '2026-02-28',
    notes: 'Arrived by email.',
  },
});

/** The first issue message for a failed parse, so a test can name the rule that rejected the value. */
function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }): string {
  if (result.success || !result.error) {
    throw new Error('expected the parse to fail');
  }
  return result.error.issues[0].message;
}

describe('the register bounds', () => {
  it('holds the values the schema is built from', () => {
    expect(REGISTER_SOURCE_URL_MAX_LENGTH).toBe(2048);
    expect(REGISTER_DISPLAY_NAME_MAX_LENGTH).toBe(200);
    expect(REGISTER_NOTES_MAX_LENGTH).toBe(2000);
  });
});

describe('registerExternalCredentialRequestSchema', () => {
  it('accepts a full body and keeps every value verbatim', () => {
    const body = validBody();
    const result = registerExternalCredentialRequestSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(body);
    }
  });

  it('accepts a body carrying only the required fields', () => {
    const result = registerExternalCredentialRequestSchema.safeParse({
      sourceUrl: 'https://supplier.example/credentials/abc',
      annotations: { displayName: 'A record', declaredCredentialType: CoreCredentialType.DCC },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceEncryption).toBeUndefined();
      expect(result.data.annotations.dateReceived).toBeUndefined();
      expect(result.data.annotations.notes).toBeUndefined();
    }
  });

  it('strips keys the contract does not name', () => {
    const result = registerExternalCredentialRequestSchema.safeParse({
      ...validBody(),
      tenantId: 'other-tenant',
      annotations: { ...validBody().annotations, storageUri: 'https://elsewhere.example' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('tenantId');
      expect(result.data.annotations).not.toHaveProperty('storageUri');
    }
  });

  describe('sourceUrl', () => {
    it('accepts a URL exactly at the maximum length', () => {
      const base = 'https://supplier.example/';
      const url = base + 'a'.repeat(REGISTER_SOURCE_URL_MAX_LENGTH - base.length);
      expect(url).toHaveLength(REGISTER_SOURCE_URL_MAX_LENGTH);
      expect(registerExternalCredentialRequestSchema.safeParse({ ...validBody(), sourceUrl: url }).success).toBe(true);
    });

    it('rejects a URL one character over the maximum length', () => {
      const base = 'https://supplier.example/';
      const url = base + 'a'.repeat(REGISTER_SOURCE_URL_MAX_LENGTH + 1 - base.length);
      const result = registerExternalCredentialRequestSchema.safeParse({ ...validBody(), sourceUrl: url });
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toMatch(/2048/);
    });

    it('rejects a value that is not a URL, naming the rule', () => {
      const result = registerExternalCredentialRequestSchema.safeParse({ ...validBody(), sourceUrl: 'not a url' });
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe('must be a valid URL');
    });

    it('rejects a URL padded with whitespace rather than trimming it', () => {
      const result = registerExternalCredentialRequestSchema.safeParse({
        ...validBody(),
        sourceUrl: ' https://supplier.example/abc ',
      });
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe('must not have leading or trailing whitespace');
    });

    it('rejects a missing sourceUrl', () => {
      const { sourceUrl: _omitted, ...body } = validBody();
      expect(registerExternalCredentialRequestSchema.safeParse(body).success).toBe(false);
    });
  });

  describe('annotations.displayName', () => {
    it('rejects a blank display name', () => {
      const body = validBody();
      body.annotations.displayName = '';
      expect(registerExternalCredentialRequestSchema.safeParse(body).success).toBe(false);
    });

    it('rejects a whitespace-only display name, naming the rule', () => {
      const body = validBody();
      body.annotations.displayName = '   ';
      const result = registerExternalCredentialRequestSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe('must not be only whitespace');
    });

    it('accepts a display name exactly at the maximum length', () => {
      const body = validBody();
      body.annotations.displayName = 'n'.repeat(REGISTER_DISPLAY_NAME_MAX_LENGTH);
      expect(registerExternalCredentialRequestSchema.safeParse(body).success).toBe(true);
    });

    it('rejects a display name one character over the maximum length', () => {
      const body = validBody();
      body.annotations.displayName = 'n'.repeat(REGISTER_DISPLAY_NAME_MAX_LENGTH + 1);
      const result = registerExternalCredentialRequestSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toMatch(/200/);
    });
  });

  describe('annotations.declaredCredentialType', () => {
    it.each(Object.values(CoreCredentialType))('accepts the core credential type %s', (type) => {
      const body = validBody();
      body.annotations.declaredCredentialType = type;
      expect(registerExternalCredentialRequestSchema.safeParse(body).success).toBe(true);
    });

    it('rejects a type outside the core credential types', () => {
      const body = validBody();
      body.annotations.declaredCredentialType = 'DPPX' as CoreCredentialType;
      expect(registerExternalCredentialRequestSchema.safeParse(body).success).toBe(false);
    });

    it('rejects a missing declaredCredentialType', () => {
      const body = validBody();
      const { declaredCredentialType: _omitted, ...annotations } = body.annotations;
      expect(registerExternalCredentialRequestSchema.safeParse({ ...body, annotations }).success).toBe(false);
    });
  });

  describe('annotations.notes', () => {
    it('accepts notes exactly at the maximum length', () => {
      const body = validBody();
      body.annotations.notes = 'x'.repeat(REGISTER_NOTES_MAX_LENGTH);
      expect(registerExternalCredentialRequestSchema.safeParse(body).success).toBe(true);
    });

    it('rejects notes one character over the maximum length', () => {
      const body = validBody();
      body.annotations.notes = 'x'.repeat(REGISTER_NOTES_MAX_LENGTH + 1);
      const result = registerExternalCredentialRequestSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toMatch(/2000/);
    });

    it('accepts empty notes, which carry no blankness rule', () => {
      const body = validBody();
      body.annotations.notes = '';
      expect(registerExternalCredentialRequestSchema.safeParse(body).success).toBe(true);
    });
  });
});

describe('calendarDateSchema', () => {
  it('accepts a real calendar date and keeps it as the string it arrived as', () => {
    expect(calendarDateSchema.safeParse('2026-02-28')).toEqual({ success: true, data: '2026-02-28' });
  });

  it('accepts the leap day of a leap year', () => {
    expect(calendarDateSchema.safeParse('2024-02-29').success).toBe(true);
  });

  it('rejects a day that does not exist in the month rather than rounding it', () => {
    const result = calendarDateSchema.safeParse('2026-02-30');
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe('must be a real calendar date in YYYY-MM-DD form');
  });

  it('rejects an unpadded date', () => {
    const result = calendarDateSchema.safeParse('2026-2-3');
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe('must be a real calendar date in YYYY-MM-DD form');
  });

  it('rejects a date-time', () => {
    const result = calendarDateSchema.safeParse('2026-02-03T00:00:00Z');
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe('must be a real calendar date in YYYY-MM-DD form');
  });

  it('rejects the same values through the request schema', () => {
    for (const value of ['2026-02-30', '2026-2-3', '2026-02-03T00:00:00Z']) {
      const body = validBody();
      body.annotations.dateReceived = value;
      expect(registerExternalCredentialRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

const HEX_KEY_MESSAGE = 'must be an AES-256-GCM key as 64 hexadecimal characters';

describe('sourceEncryptionSchema', () => {
  it('accepts a key on its own, with the method optional', () => {
    const result = sourceEncryptionSchema.safeParse({ decryptionKey: 'a'.repeat(64) });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.encryptionMethod).toBeUndefined();
    }
  });

  it('rejects a block with no decryptionKey', () => {
    expect(sourceEncryptionSchema.safeParse({ encryptionMethod: 'AES-256-GCM' }).success).toBe(false);
  });

  it('accepts a 64-character lowercase hexadecimal key', () => {
    expect(sourceEncryptionSchema.safeParse({ decryptionKey: '0123456789abcdef'.repeat(4) }).success).toBe(true);
  });

  it('accepts the same key in uppercase, because hexadecimal is case-insensitive', () => {
    expect(sourceEncryptionSchema.safeParse({ decryptionKey: '0123456789ABCDEF'.repeat(4) }).success).toBe(true);
  });

  it('rejects a 63-character key, naming the rule', () => {
    const result = sourceEncryptionSchema.safeParse({ decryptionKey: 'a'.repeat(63) });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(HEX_KEY_MESSAGE);
  });

  it('rejects a 65-character key, naming the rule', () => {
    const result = sourceEncryptionSchema.safeParse({ decryptionKey: 'a'.repeat(65) });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(HEX_KEY_MESSAGE);
  });

  it('rejects a 64-character key carrying a non-hexadecimal character, naming the rule', () => {
    const result = sourceEncryptionSchema.safeParse({ decryptionKey: `${'a'.repeat(63)}z` });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(HEX_KEY_MESSAGE);
  });

  it('rejects a blank decryptionKey, naming the rule', () => {
    const result = sourceEncryptionSchema.safeParse({ decryptionKey: '' });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(HEX_KEY_MESSAGE);
  });

  it('rejects a blank encryptionMethod when one is supplied', () => {
    expect(sourceEncryptionSchema.safeParse({ decryptionKey: 'a'.repeat(64), encryptionMethod: '  ' }).success).toBe(
      false,
    );
  });

  it('rejects the same shortfalls through the request schema', () => {
    const body = validBody();
    expect(
      registerExternalCredentialRequestSchema.safeParse({ ...body, sourceEncryption: { encryptionMethod: 'AES' } })
        .success,
    ).toBe(false);
    expect(
      registerExternalCredentialRequestSchema.safeParse({ ...body, sourceEncryption: { decryptionKey: '' } }).success,
    ).toBe(false);
  });
});
