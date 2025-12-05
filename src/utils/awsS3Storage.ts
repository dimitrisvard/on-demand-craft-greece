import { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getPresignedUrl } from '@aws-sdk/s3-request-presigner';

// Helper to get client lazily
let s3ClientInstance: S3Client | null = null;

const getS3Client = () => {
  if (s3ClientInstance) return s3ClientInstance;

  const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';
  const accessKeyId = import.meta.env.VITE_AWS_ACCESS_KEY_ID;
  const secretAccessKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.error('AWS credentials missing. Please check VITE_AWS_ACCESS_KEY_ID and VITE_AWS_SECRET_ACCESS_KEY');
    throw new Error('AWS Credentials are required');
  }

  try {
    s3ClientInstance = new S3Client({
      region,
      credentials: {
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      },
    });
    return s3ClientInstance;
  } catch (error) {
    console.error('Failed to initialize S3 client:', error);
    throw error;
  }
};

/**
 * Upload a file to S3 using presigned URL (more reliable for browser uploads)
 * @param file The file to upload
 * @param prefix Optional prefix for the file path
 * @returns The file path if successful, null if failed
 */
export const uploadFileToS3 = async (file: File, prefix?: string): Promise<string | null> => {
  try {
    const bucketName = import.meta.env.VITE_AWS_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('AWS Bucket name is required (VITE_AWS_BUCKET_NAME)');
    }

    const client = getS3Client();

    // Create a unique file path with original filename
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = prefix 
      ? `${prefix}/${safeFileName}`
      : safeFileName;

    console.log(`Uploading file to S3: ${bucketName}/${filePath}`);

    // Generate a presigned PUT URL
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: filePath,
      ContentType: file.type || 'application/octet-stream',
    });

    const presignedUrl = await getPresignedUrl(client, putCommand, { expiresIn: 300 }); // 5 minutes

    // Upload using simple fetch with presigned URL (avoids SDK CORS issues)
    const response = await fetch(presignedUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('S3 upload failed:', response.status, errorText);
      throw new Error(`S3 upload failed: ${response.status} ${errorText}`);
    }

    console.log('File uploaded successfully to S3');
    return filePath;
  } catch (error: any) {
    console.error('Error uploading file to S3:', error);
    if (error.name === 'InvalidAccessKeyId') {
      console.error('CRITICAL: The AWS Access Key ID is invalid. Check Vercel environment variables.');
    }
    return null;
  }
};

/**
 * Get a signed URL for a file
 * @param filePath The file path in S3
 * @returns The signed URL if successful, null if failed
 */
export const getSignedUrl = async (filePath: string): Promise<string | null> => {
  try {
    const bucketName = import.meta.env.VITE_AWS_BUCKET_NAME;
    if (!bucketName) throw new Error('AWS Bucket name is required');

    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: filePath,
    });

    const url = await getPresignedUrl(client, command, { expiresIn: 3600 });
    return url;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return null;
  }
};

/**
 * Delete a file from S3
 * @param filePath The file path in S3
 * @returns true if successful, false if failed
 */
export const deleteFileFromS3 = async (filePath: string): Promise<boolean> => {
  try {
    const bucketName = import.meta.env.VITE_AWS_BUCKET_NAME;
    if (!bucketName) throw new Error('AWS Bucket name is required');

    const client = getS3Client();
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: filePath,
    });

    await client.send(command);
    console.log('File deleted successfully from S3:', filePath);
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    return false;
  }
};

/**
 * Delete an entire folder from S3 by prefix
 * This is useful when deleting an RFQ and all its associated files
 * @param folderPrefix The folder prefix to delete (e.g., "RFQ-12345678-1/")
 * @returns true if any deletion was attempted, false if failed or empty
 */
export const deleteFolderFromS3 = async (folderPrefix: string): Promise<boolean> => {
  try {
    console.log(`Attempting to delete folder with prefix: ${folderPrefix}`);
    const bucketName = import.meta.env.VITE_AWS_BUCKET_NAME;
    if (!bucketName) throw new Error('AWS Bucket name is required');

    const client = getS3Client();

    // First, list all objects with the given prefix
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: folderPrefix,
    });

    const listedObjects = await client.send(listCommand);
    if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
      console.log(`No objects found with prefix: ${folderPrefix}`);
      return false;
    }

    console.log(`Found ${listedObjects.Contents.length} objects to delete`);
    
    // Delete each object individually
    for (const object of listedObjects.Contents) {
      if (!object.Key) continue;
      
      const deleteCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: object.Key,
      });
      
      await client.send(deleteCommand);
      console.log(`Deleted object: ${object.Key}`);
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting folder from S3:', error);
    return false;
  }
};
