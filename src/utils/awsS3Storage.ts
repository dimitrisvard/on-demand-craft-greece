import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl as getPresignedUrl } from '@aws-sdk/s3-request-presigner';

// Debug logging for environment variables
console.log('Environment Variables:', {
  region: import.meta.env.VITE_AWS_REGION,
  bucket: import.meta.env.VITE_AWS_BUCKET_NAME,
  hasAccessKey: !!import.meta.env.VITE_AWS_ACCESS_KEY_ID,
  hasSecretKey: !!import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
  allEnv: import.meta.env
});

// Initialize S3 client with error handling
let s3Client: S3Client;
try {
  const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';
  const bucketName = import.meta.env.VITE_AWS_BUCKET_NAME;
  
  console.log('Initializing S3 client with:', {
    region,
    bucketName,
    hasBucketName: !!bucketName
  });

  if (!bucketName) {
    throw new Error('AWS Bucket name is required. Please check your .env file and make sure VITE_AWS_BUCKET_NAME is set.');
  }

  s3Client = new S3Client({
    region,
    credentials: {
      accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID || '',
      secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || '',
    },
  });

  console.log('S3 client initialized successfully');
} catch (error) {
  console.error('Error initializing S3 client:', error);
  throw error;
}

/**
 * Upload a file to S3
 * @param file The file to upload
 * @param prefix Optional prefix for the file path
 * @returns The file path if successful, null if failed
 */
export const uploadFileToS3 = async (file: File, prefix?: string): Promise<string | null> => {
  try {
    const bucketName = import.meta.env.VITE_AWS_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('AWS Bucket name is required');
    }

    // Create a unique file path with original filename
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = prefix 
      ? `${prefix}/${safeFileName}`
      : safeFileName;

    console.log(`Uploading file to S3: ${bucketName}/${filePath}`);

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: bucketName,
        Key: filePath,
        Body: file,
        ContentType: file.type || 'application/octet-stream',
      },
    });

    await upload.done();
    console.log('File uploaded successfully to S3');
    return filePath;
  } catch (error) {
    console.error('Error uploading file to S3:', error);
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
    if (!bucketName) {
      throw new Error('AWS Bucket name is required');
    }

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: filePath,
    });

    const url = await getPresignedUrl(s3Client, command, { expiresIn: 3600 });
    console.log('Generated signed URL for file:', filePath);
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
    if (!bucketName) {
      throw new Error('AWS Bucket name is required');
    }

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: filePath,
    });

    await s3Client.send(command);
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
    if (!bucketName) {
      throw new Error('AWS Bucket name is required');
    }

    // First, list all objects with the given prefix
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: folderPrefix,
    });

    const listedObjects = await s3Client.send(listCommand);
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
      
      await s3Client.send(deleteCommand);
      console.log(`Deleted object: ${object.Key}`);
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting folder from S3:', error);
    return false;
  }
}; 