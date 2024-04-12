import { publicAPI } from './utils/httpService.js';

export type Json = {
  [key: string]: any;
};

export interface IUploadedJson {
  filename: string;
  bucket: string;
  json: Json;
  storageAPIUrl: string;
}
/**
 * Uploads a json file to S3 storage.
 *
 * @param filename
 * @param json
 * @param bucket
 * @param storageAPIUrl
 * @param typeBucket
 * @returns link to the uploaded json file
 *
 * @example
 * const json = {
 *  "name": "John",
 *  "age": 30,
 * }
 * const url = await uploadJson('test', json, BucketName.PublicVC, 'https://storage.com', 'bucket-verifiable-credentials');
 * // Returns: https://storage.com/test.json
 */
export const uploadJson = async ({ filename, bucket, json, storageAPIUrl }: IUploadedJson): Promise<string> => {
  try {
    if (!storageAPIUrl) throw new Error('storageAPIUrl is not defined');

    if (!bucket) throw new Error('bucket is not defined');

    const file = new File([JSON.stringify(json)], `${filename}`, {
      type: 'application/json',
    });

    const presignedUrlParams = {
      bucket: bucket,
      key: file.name,
      fileType: file.type,
    };
    const { presignedUrl } = await publicAPI.post<{ presignedUrl: string }>(
      `${storageAPIUrl}/presigned-url`,
      presignedUrlParams,
    );

    publicAPI.setContentTypeHeader(file.type);
    await publicAPI.put(presignedUrl.toString(), file);

    return `https://${bucket}.s3.ap-southeast-2.amazonaws.com/${file.name}`;
  } catch (error: any) {
    throw new Error(error.message ?? 'Error uploading json');
  }
};

class LocalStorageService {
  private static instance: LocalStorageService | null = null;

  private constructor() {
    // Private constructor to prevent external instantiation
  }

  static getInstance(): LocalStorageService {
    if (!LocalStorageService.instance) {
      LocalStorageService.instance = new LocalStorageService();
    }
    return LocalStorageService.instance;
  }

  // Retrieve an item from local storage
  get(key: string): string | null {
    return localStorage.getItem(key);
  }

  // Save an item to local storage
  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  // Remove an item from local storage
  remove(key: string): void {
    localStorage.removeItem(key);
  }
}

export default LocalStorageService.getInstance();
