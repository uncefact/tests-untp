import type { IDataModelBridge, SubjectSummary, UNTPVerifiableCredential } from '@uncefact/untp-ri-services';
import { extractCredentialDetails } from './extract-credential-details';

const ISSUER = { type: ['Organization'], id: 'did:web:issuer.example', name: 'Issuer Co' };
const SUBJECT = { type: ['Product'], id: 'https://example.com/p/1', name: 'Widget' };

function stubBridge(summary: SubjectSummary = { id: SUBJECT.id, name: SUBJECT.name }): IDataModelBridge {
  return {
    buildSubject: jest.fn(),
    extractRefs: jest.fn(),
    extractConformityClaim: jest.fn(),
    extractConformityClaimWithProvenance: jest.fn(),
    extractSubjectSummary: jest.fn().mockReturnValue(summary),
  };
}

function extract(overrides: Record<string, unknown> = {}, bridge: IDataModelBridge = stubBridge()) {
  return extractCredentialDetails(
    {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      id: 'urn:uuid:test',
      issuer: ISSUER,
      credentialSubject: SUBJECT,
      credentialStatus: {
        id: 'https://example.com/status#1',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: 0,
        statusListCredential: 'https://example.com/status',
      },
      ...overrides,
    } as UNTPVerifiableCredential,
    bridge,
  );
}

describe('extractCredentialDetails', () => {
  describe('name', () => {
    it('returns the credential name when it is a non-empty string', () => {
      expect(extract({ name: 'Wool Passport' }).name).toBe('Wool Passport');
    });

    it('returns null when name is absent', () => {
      expect(extract().name).toBeNull();
    });

    it('returns null when name is an empty string', () => {
      expect(extract({ name: '' }).name).toBeNull();
    });

    it('returns null when name is not a string', () => {
      expect(extract({ name: 42 }).name).toBeNull();
    });
  });

  describe('issuer', () => {
    it('reads id and name from an issuer object', () => {
      const details = extract({
        issuer: { id: 'did:web:issuer.example', name: 'Issuer Co' },
      });

      expect(details.issuerDid).toBe('did:web:issuer.example');
      expect(details.issuerName).toBe('Issuer Co');
    });

    it('returns a null issuer name when the object has none', () => {
      const details = extract({ issuer: { id: 'did:web:issuer.example' } });

      expect(details.issuerDid).toBe('did:web:issuer.example');
      expect(details.issuerName).toBeNull();
    });

    it('returns a null issuer name when the object name is empty', () => {
      const details = extract({ issuer: { id: 'did:web:issuer.example', name: '' } });

      expect(details.issuerDid).toBe('did:web:issuer.example');
      expect(details.issuerName).toBeNull();
    });

    it('uses a string issuer as the DID and has no issuer name', () => {
      const details = extract({ issuer: 'did:web:issuer.example' });

      expect(details.issuerDid).toBe('did:web:issuer.example');
      expect(details.issuerName).toBeNull();
    });

    it('returns a null issuer DID when the object id is not a string', () => {
      const details = extract({ issuer: { id: 12, name: 'Issuer Co' } });

      expect(details.issuerDid).toBeNull();
      expect(details.issuerName).toBe('Issuer Co');
    });
  });

  describe('subject', () => {
    it('uses the id and name the bridge returns for a single subject object', () => {
      const subject = { id: 'https://example.com/p/1', name: 'Widget' };
      const bridge = stubBridge({ id: 'https://bridge.example/s', name: 'From the bridge' });
      const details = extract({ credentialSubject: subject }, bridge);

      expect(details.subjectId).toBe('https://bridge.example/s');
      expect(details.subjectName).toBe('From the bridge');
      expect(bridge.extractSubjectSummary).toHaveBeenCalledWith(subject);
    });

    it('hands an array subject to the bridge as the credential carries it', () => {
      // Which of several subjects a row describes is the bridge's decision,
      // not this function's; it must not unwrap or drop the array first.
      const bridge = stubBridge({ id: 'https://example.com/p/1', name: 'Widget' });
      const credentialSubject = [
        { id: 'https://example.com/p/1', name: 'Widget' },
        { id: 'https://example.com/p/2', name: 'Gadget' },
      ];

      const details = extract({ credentialSubject }, bridge);

      expect(details.subjectId).toBe('https://example.com/p/1');
      expect(details.subjectName).toBe('Widget');
      expect(bridge.extractSubjectSummary).toHaveBeenCalledWith(credentialSubject);
    });

    it('lets a throwing bridge surface, so the caller can record why the read failed', () => {
      const bridge = stubBridge();
      (bridge.extractSubjectSummary as jest.Mock).mockImplementation(() => {
        throw new Error('bridge defect');
      });

      expect(() => extract({}, bridge)).toThrow('bridge defect');
    });
  });

  describe('validity dates', () => {
    it('parses valid ISO-8601 datetimes', () => {
      const details = extract({
        validFrom: '2024-01-15T00:00:00.000Z',
        validUntil: '2025-01-15T00:00:00.000Z',
      });

      expect(details.validFrom).toEqual(new Date('2024-01-15T00:00:00.000Z'));
      expect(details.validUntil).toEqual(new Date('2025-01-15T00:00:00.000Z'));
    });

    it('returns null when the dates are missing', () => {
      const details = extract();

      expect(details.validFrom).toBeNull();
      expect(details.validUntil).toBeNull();
    });

    it('returns null for a date JavaScript would normalise rather than reject', () => {
      // 30 February does not exist; new Date() would silently make it 1 March.
      expect(extract({ validFrom: '2024-02-30T00:00:00Z' }).validFrom).toBeNull();
    });

    it('returns null for a loose form that is not an RFC 3339 date-time', () => {
      expect(extract({ validFrom: '0' }).validFrom).toBeNull();
      expect(extract({ validFrom: '2024-01-15' }).validFrom).toBeNull();
      expect(extract({ validFrom: 'January 15, 2024' }).validFrom).toBeNull();
    });

    it('accepts an offset date-time and stores the same moment in UTC', () => {
      expect(extract({ validFrom: '2024-01-15T23:30:00+10:00' }).validFrom).toEqual(
        new Date('2024-01-15T13:30:00.000Z'),
      );
    });

    it('returns null for unparseable dates', () => {
      const details = extract({ validFrom: 'not-a-date', validUntil: 'also-not-a-date' });

      expect(details.validFrom).toBeNull();
      expect(details.validUntil).toBeNull();
    });
  });
});
