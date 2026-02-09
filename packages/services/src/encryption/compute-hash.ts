import crypto from 'crypto';

export enum HashAlgorithm {
  SHA256 = 'sha256',
}

export const computeHash = (
  input: string | Uint8Array | Record<string, any>,
  algorithm: HashAlgorithm = HashAlgorithm.SHA256,
): string => {
  const data =
    typeof input === 'string' ? input : input instanceof Uint8Array ? Buffer.from(input) : JSON.stringify(input);
  return crypto.createHash(algorithm).update(data).digest('hex');
};
