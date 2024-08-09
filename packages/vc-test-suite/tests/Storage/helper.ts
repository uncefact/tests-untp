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
 * @param {string} key - Decryption key
 * @returns {string} - Decrypted data
 */
export function decryptData({ cipherText, iv, tag }: EncryptedData, key: string) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(cipherText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
