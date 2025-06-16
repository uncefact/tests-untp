import {
  constructElementString,
  constructIdentifierData,
  constructQualifierPath,
} from '../../identifierSchemes/identifierSchemeServices';

describe('IdentifierSchemeServices', () => {
  describe('constructIdentifierData', () => {
    it('should parse link resolver URL to AIs when identifierKeyPath is a string', () => {
      const identifierKeyPath = '/path/to/identifier';
      const data = { path: { to: { identifier: 'https://example.com/abc/01/12345/02/67890' } } };
      const result = constructIdentifierData(identifierKeyPath, data);
      expect(result).toEqual({
        primary: { ai: '01', value: '12345' },
        qualifiers: [{ ai: '02', value: '67890' }],
      });
    });

    it('should construct AI data when identifierKeyPath is an object', () => {
      const identifierKeyPath = {
        primary: { ai: '01', path: '/primary/path' },
        qualifiers: [{ ai: '02', path: '/qualifier/path' }],
      };
      const data = { primary: { path: '12345' }, qualifier: { path: '67890' } };
      const result = constructIdentifierData(identifierKeyPath, data);
      expect(result).toEqual({
        primary: { ai: '01', value: '12345' },
        qualifiers: [{ ai: '02', value: '67890' }],
      });
    });

    it('should construct AI data when identifierKeyPath is an object with undefined qualifiers', () => {
      const identifierKeyPath = {
        primary: { ai: '01', path: '/primary/path' },
        qualifiers: [],
      };
      const data = { primary: { path: '12345' } };
      const result = constructIdentifierData(identifierKeyPath, data);
      expect(result).toEqual({
        primary: { ai: '01', value: '12345' },
        qualifiers: [],
      });
    });

    it('should throw an error for invalid identifierKeyPath', () => {
      expect(() => constructIdentifierData(123 as any, {})).toThrow('Invalid identifierKeyPath');
    });
  });

  describe('constructElementString', () => {
    it('should construct element string correctly', () => {
      const aiData = {
        primary: { ai: '01', value: '12345' },
        qualifiers: [
          { ai: '02', value: '67890' },
          { ai: '03', value: '54321' },
        ],
      };
      const result = constructElementString(aiData);
      expect(result).toBe('(01)12345(02)67890(03)54321');
    });

    it('should construct element string correctly for no qualifiers', () => {
      const aiData = {
        primary: { ai: '01', value: '12345' },
        qualifiers: [],
      };
      const result = constructElementString(aiData);
      expect(result).toBe('(01)12345');
    });

    it('should construct element string correctly for undefined qualifiers', () => {
      const aiData: any = {
        primary: { ai: '01', value: '12345' },
      };
      const result = constructElementString(aiData);
      expect(result).toBe('(01)12345');
    });

    it('should throw an error for missing primary AI or value', () => {
      const aiData: any = {
        primary: { ai: '01' },
        qualifiers: [{ ai: '02', value: '67890' }],
      };
      expect(() => constructElementString(aiData)).toThrow('Primary AI or value not found');
    });
  });

  describe('constructQualifierPath', () => {
    it('should return "/" for empty qualifiers', () => {
      const result = constructQualifierPath([]);
      expect(result).toBe('/');
    });

    it('should construct qualifier path correctly', () => {
      const qualifiers = [
        { ai: '02', value: '67890' },
        { ai: '03', value: '54321' },
      ];
      const result = constructQualifierPath(qualifiers);
      expect(result).toBe('/02/67890/03/54321');
    });

    it('should return "/" for undefined qualifiers', () => {
      const result = constructQualifierPath(undefined as any);
      expect(result).toBe('/');
    });
  });
});
