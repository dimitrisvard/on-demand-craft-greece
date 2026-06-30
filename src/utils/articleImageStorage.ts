// S3 storage helpers for article images.
//
// All AWS operations run server-side via /api/s3 (scope "articles") so AWS
// credentials are never bundled into the browser. Public function signatures
// are unchanged.
import { callS3 } from './s3Api';

const SCOPE = 'articles' as const;

/**
 * Upload an article image to S3.
 * @param file The file to upload
 * @param type 'featured' or 'content'
 * @param articleId The ID of the article
 * @returns The full public URL of the uploaded image, or null on failure
 */
export const uploadArticleImageToS3 = async (
  file: File,
  type: 'featured' | 'content',
  articleId: string
): Promise<string | null> => {
  try {
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${Date.now()}_${safeFileName}`;
    const prefix = `${type}/${articleId}`;

    const { uploadUrl, publicUrl } = await callS3<{ uploadUrl: string; publicUrl: string }>(
      'presign-upload',
      {
        fileName,
        contentType: file.type || 'application/octet-stream',
        prefix,
        scope: SCOPE,
      }
    );

    console.log(`Uploading article image to S3: ${prefix}/${fileName}`);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    if (!response.ok) {
      throw new Error(`S3 upload failed: ${response.status}`);
    }

    return publicUrl;
  } catch (error) {
    console.error('Error uploading article image:', error);
    return null;
  }
};

/**
 * Delete an article image from S3.
 * @param imageUrl The full URL or key of the image
 */
export const deleteArticleImageFromS3 = async (imageUrl: string): Promise<boolean> => {
  try {
    // Extract the object key from a full URL.
    let key = imageUrl;
    if (imageUrl.startsWith('http')) {
      const url = new URL(imageUrl);
      key = url.pathname.substring(1); // Remove leading slash
    }

    await callS3('delete', { key, scope: SCOPE });
    return true;
  } catch (error) {
    console.error('Error deleting article image:', error);
    return false;
  }
};

/**
 * List article images from S3.
 * @param type 'featured' or 'content' (optional filter)
 * @param articleId (optional filter)
 */
export const listArticleImages = async (
  type?: 'featured' | 'content',
  articleId?: string
): Promise<Array<{ key: string; url: string; lastModified?: Date }>> => {
  try {
    let prefix = '';
    if (type) {
      prefix += `${type}/`;
      if (articleId) {
        prefix += `${articleId}/`;
      }
    }

    const { objects } = await callS3<{
      objects: Array<{ key: string; url: string; lastModified?: string }>;
    }>('list', { prefix, scope: SCOPE });

    return (objects || []).map((item) => ({
      key: item.key,
      url: item.url,
      lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
    }));
  } catch (error) {
    console.error('Error listing article images:', error);
    return [];
  }
};
