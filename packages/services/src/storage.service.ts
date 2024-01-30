import { publicAPI } from './utils/httpService';

export type Json = {
  [key: string]: unknown;
};

export enum BucketName {
  PublicVC = 'PublicVCBucket',
  PrivateVC = 'PrivateVCBucket',
  EPCISEvent = 'EPCISEventBucket',
}

export interface ITypeBucket {
  [key: string]: string;
}

export interface IUploadedJson {
  filename: string;
  bucket: BucketName;
  json: Json;
  typeBucket: ITypeBucket;
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
export const uploadJson = async ({
  filename,
  bucket,
  json,
  storageAPIUrl,
  typeBucket,
}: IUploadedJson): Promise<string> => {
  try {
    if (!storageAPIUrl) throw new Error('REACT_APP_STORAGE_API_URL is not defined');

    const bucketNameMapping = {
      PublicVCBucket: typeBucket.PublicVCBucket,
      PrivateVCBucket: typeBucket.PrivateVCBucket,
      EPCISEventBucket: typeBucket.EPCISEventBucket,
    };

    if (!bucketNameMapping[bucket]) throw new Error('Invalid bucket name');

    const file = new File([JSON.stringify(json)], `${filename}`, {
      type: 'application/json',
    });

    const presignedUrlParams = {
      bucket: bucketNameMapping[bucket],
      key: file.name,
      fileType: file.type,
    };
    const { presignedUrl } = await publicAPI.post<{ presignedUrl: string }>(
      `${storageAPIUrl}/presigned-url`,
      presignedUrlParams,
    );

    publicAPI.setContentTypeHeader(file.type);
    await publicAPI.put(presignedUrl.toString(), file);

    return `https://${bucketNameMapping[bucket]}.s3.ap-southeast-2.amazonaws.com/${file.name}`;
  } catch (error) {
    throw new Error('Error uploading json');
  }
};
