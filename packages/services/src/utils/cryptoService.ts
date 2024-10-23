import crypto from 'crypto';

export enum HashAlgorithm {
  SHA256 = 'sha256',
}

export enum EncryptionAlgorithm {
  AES_256_GCM = 'aes-256-gcm',
}

const keyLengthMap = {
  [EncryptionAlgorithm.AES_256_GCM]: 32,
};

const ivLengthMap = {
  [EncryptionAlgorithm.AES_256_GCM]: 12,
};

const tagLengthMap = {
  [EncryptionAlgorithm.AES_256_GCM]: 16,
};

export interface DecryptionParams {
  cipherText: string;
  key: string; // Hexadecimal string
  iv: string; // Base64 string
  tag: string; // Base64 string
  type: EncryptionAlgorithm;
}

/**
 * Decrypts an encrypted credential using the specified parameters.
 * @param {DecryptionParams} params - The decryption parameters.
 * @param {string} params.cipherText - The encrypted text in base64 format.
 * @param {string} params.key - The encryption key in hexadecimal format.
 * @param {string} params.iv - The initialisation vector in base64 format.
 * @param {string} params.tag - The authentication tag in base64 format.
 * @param {EncryptionAlgorithm} params.type - The encryption algorithm used.
 * @returns {string} The decrypted credential as a UTF-8 string.
 * @throws {Error} If decryption fails or if any of the input parameters are invalid.
 */
export const decryptCredential = ({ cipherText, key, iv, tag, type }: DecryptionParams) => {
  try {
    if (!type) {
      throw new Error('Encryption type is required');
    }

    // Check if the type is supported
    if (!Object.values(EncryptionAlgorithm).includes(type)) {
      throw new Error(`Unsupported encryption type: ${type}`);
    }

    // Decode key from hex to Uint8Array
    const keyBuffer = new Uint8Array(Buffer.from(key, 'hex'));
    if (keyBuffer.length !== keyLengthMap[type]) {
      throw new Error(
        `Invalid key length: ${keyBuffer.length} bytes. Expected ${keyLengthMap[type]} bytes for ${type}.`,
      );
    }

    // Decode IV from base64 to Uint8Array
    const ivBuffer = new Uint8Array(Buffer.from(iv, 'base64'));
    if (ivBuffer.length !== ivLengthMap[type]) {
      throw new Error(`Invalid IV length: ${ivBuffer.length} bytes. Expected ${ivLengthMap[type]} bytes for ${type}.`);
    }

    // Decode Auth Tag from base64 to Uint8Array
    const tagBuffer = new Uint8Array(Buffer.from(tag, 'base64'));
    if (tagBuffer.length !== tagLengthMap[type]) {
      throw new Error(
        `Invalid Auth Tag length: ${tagBuffer.length} bytes. Expected ${tagLengthMap[type]} bytes for ${type}.`,
      );
    }

    // Initialize decipher with algorithm, key, and IV
    const decipher = crypto.createDecipheriv(type, keyBuffer, ivBuffer);

    // Set the authentication tag
    decipher.setAuthTag(tagBuffer);

    // Decrypt the ciphertext
    let decrypted = decipher.update(cipherText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw error;
  }
};

/**
 * Computes a hash of the given credential object.
 * @param {Record<string, any>} credential - The credential object to hash.
 * @param {HashAlgorithm} [algorithm=HashAlgorithm.SHA256] - The hashing algorithm to use.
 * @returns {string} The computed hash as a hexadecimal string.
 */
export const computeHash = (credential: Record<string, any>, algorithm: HashAlgorithm = HashAlgorithm.SHA256) => {
  const credentialJsonString = JSON.stringify(credential);
  return crypto.createHash(algorithm).update(credentialJsonString).digest('hex');
};