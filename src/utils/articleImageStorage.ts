import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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

const getBucketName = () => {
  return import.meta.env.VITE_AWS_ARTICLES_BUCKET_NAME || 'articles';
};

/**
 * Upload an article image to S3
 * @param file The file to upload
 * @param type 'featured' or 'content'
 * @param articleId The ID of the article
 * @returns The full URL of the uploaded image
 */
export const uploadArticleImageToS3 = async (
  file: File, 
  type: 'featured' | 'content', 
  articleId: string
): Promise<string | null> => {
  try {
    const bucketName = getBucketName();
    const client = getS3Client();

    // Create a unique file path
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${type}/${articleId}/${Date.now()}_${safeFileName}`;

    console.log(`Uploading article image to S3: ${bucketName}/${filePath}`);

    // Generate a presigned PUT URL
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: filePath,
      ContentType: file.type || 'application/octet-stream',
    });

    const presignedUrl = await getPresignedUrl(client, putCommand, { expiresIn: 300 });

    // Upload using simple fetch
    const response = await fetch(presignedUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    if (!response.ok) {
      throw new Error(`S3 upload failed: ${response.status}`);
    }

    // Construct the public URL
    // Assuming the bucket is public or served via CloudFront/S3 URL
    // If using Vercel Blob or similar, this might differ. 
    // Standard S3 URL: https://{bucket}.s3.{region}.amazonaws.com/{key}
    const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';
    const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${filePath}`;
    
    return publicUrl;
  } catch (error) {
    console.error('Error uploading article image:', error);
    return null;
  }
};

/**
 * Delete an article image from S3
 * @param imageUrl The full URL or key of the image
 */
export const deleteArticleImageFromS3 = async (imageUrl: string): Promise<boolean> => {
  try {
    const bucketName = getBucketName();
    const client = getS3Client();
    
    // Extract key from URL
    let key = imageUrl;
    if (imageUrl.startsWith('http')) {
      const url = new URL(imageUrl);
      key = url.pathname.substring(1); // Remove leading slash
    }

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await client.send(command);
    return true;
  } catch (error) {
    console.error('Error deleting article image:', error);
    return false;
  }
};

/**
 * List article images from S3
 * @param type 'featured' or 'content' (optional filter)
 * @param articleId (optional filter)
 */
export const listArticleImages = async (type?: 'featured' | 'content', articleId?: string): Promise<Array<{key: string, url: string, lastModified?: Date}>> => {
  try {
    const bucketName = getBucketName();
    const client = getS3Client();
    const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';

    let prefix = '';
    if (type) {
      prefix += `${type}/`;
      if (articleId) {
        prefix += `${articleId}/`;
      }
    }

    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix
    });

    const response = await client.send(command);
    
    return (response.Contents || []).map(item => ({
      key: item.Key!,
      url: `https://${bucketName}.s3.${region}.amazonaws.com/${item.Key}`,
      lastModified: item.LastModified
    }));
  } catch (error) {
    console.error('Error listing article images:', error);
    return [];
  }
};

