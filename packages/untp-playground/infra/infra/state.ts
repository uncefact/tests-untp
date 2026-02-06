import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export function createStateBucket() {
  // Define the S3 bucket where the Pulumi state will be stored
  const s3BucketName = 'untp-pg-state-bucket';

  // Create an S3 Bucket for storing state files
  const stateBucket = new aws.s3.Bucket(
    s3BucketName,
    {
      acl: 'private', // Private ACL so only the specified AWS credentials can access it
      versioning: {
        enabled: true, // Enable versioning for backup and recovery
      },
      // Additional settings like server-side encryption, lifecycle rules, etc., could be configured here
    },
    { ignoreChanges: ['prop'] },
  );

  // Construct the S3 backend URL dynamically based on the bucket we've created
  const backendUrl = pulumi.interpolate`s3://${stateBucket.id}`;

  // The state bucket needs to be provisioned before the backend configuration
  return { backendUrl, stateBucket };
}
