import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { decryptData, generateGUID } from '../tests/Storage/helper';

jest.mock('uuid');
jest.mock('crypto');

describe('generateGUID', () => {
  it('should return a GUID', () => {
    const mockUUID = '123e4567-e89b-12d3-a456-426614174000';
    (uuidv4 as jest.Mock).mockReturnValue(mockUUID);

    const result = generateGUID();
    expect(result).toBe(mockUUID);
    expect(uuidv4).toHaveBeenCalledTimes(1);
  });
});

describe('decryptData', () => {
  const mockEncryptedData = {
    cipherText: 'mockCipherText',
    iv: 'mockIV',
    tag: 'mockTag',
  };
  const mockKey = 'mockKey';
  const mockDecryptedBase64 = 'ZGVjcnlwdGVkIGRhdGE='; // base64 for "decrypted data"
  const mockDecrypted = 'decrypted data';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return decrypted data when given valid input', () => {
    (crypto.createDecipheriv as jest.Mock).mockReturnValue({
      setAuthTag: jest.fn(),
      update: jest.fn().mockReturnValue(mockDecryptedBase64),
      final: jest.fn().mockReturnValue(''),
    });

    const result = decryptData(mockEncryptedData, mockKey);
    expect(result).toBe(mockDecrypted);
  });

  it('should throw an error if decryption fails', () => {
    (crypto.createDecipheriv as jest.Mock).mockReturnValue({
      setAuthTag: jest.fn(),
      update: jest.fn(),
      final: jest.fn().mockImplementation(() => {
        throw new Error('Decryption failed');
      }),
    });

    expect(() => decryptData(mockEncryptedData, mockKey)).toThrow('Decryption failed');
  });

  it('should return the original string for non-base64 decryption result', () => {
    const nonBase64String = 'not a base64 string';
    (crypto.createDecipheriv as jest.Mock).mockReturnValue({
      setAuthTag: jest.fn(),
      update: jest.fn().mockReturnValue(nonBase64String),
      final: jest.fn().mockReturnValue(''),
    });

    const originalBufferFrom = Buffer.from;
    jest.spyOn(Buffer, 'from').mockImplementation((input: any, encoding?: string) => {
      if (input === nonBase64String && encoding === 'base64') {
        throw new Error('Invalid base64 string');
      }
      return originalBufferFrom(input);
    });

    const result = decryptData(mockEncryptedData, mockKey);

    expect(result).toBe(nonBase64String);
    expect(Buffer.from).toHaveBeenCalledWith(nonBase64String, 'base64');
  });
});
