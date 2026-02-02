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
export function decryptData({ cipherText, iv, tag }: EncryptedData, key: string): Record<string, any> | string {
  const keyBuffer = new Uint8Array(Buffer.from(key, 'hex'));
  const ivBuffer = new Uint8Array(Buffer.from(iv, 'base64'));
  const tagBuffer = new Uint8Array(Buffer.from(tag, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, ivBuffer);
  decipher.setAuthTag(tagBuffer);
  let decrypted = decipher.update(cipherText, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  try {
    return JSON.parse(decrypted);
  } catch (error) {
    return decrypted;
  }
}
