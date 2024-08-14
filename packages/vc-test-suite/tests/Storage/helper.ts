import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generates a random GUID
 * @returns {string} - Generated GUID
 */
export function generateGUID() {
  return uuidv4();
}

interface EncryptedData {
  cipherText: string;
  iv: string;
  tag: string;
}

/**
 * Decrypts given data using AES-GCM
 * @param {object} encryptedData - Object containing cipherText, IV, and tag
 * @param {string} key - Decryption key in hexadecimal format
 * @returns {string} - Decrypted data
 */
export function decryptData({ cipherText, iv, tag }: EncryptedData, key: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  let decrypted = decipher.update(cipherText, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  // Try to decode the base64 string, if it fails, return the original string
  try {
    return Buffer.from(decrypted, 'base64').toString('utf8');
  } catch (error) {
    return decrypted;
  }
}
