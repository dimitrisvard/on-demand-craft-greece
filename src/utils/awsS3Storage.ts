// S3 storage helpers for RFQ files.
//
// All AWS operations run server-side via /api/s3 so that AWS credentials are
// never bundled into the browser. The public function signatures are unchanged,
// so existing callers continue to work without modification.
import { callS3 } from './s3Api';

const SCOPE = 'rfq' as const;

/**
 * Upload a file to S3 via a server-issued presigned URL.
 * @param file The file to upload
 * @param prefix Optional prefix for the file path
 * @returns The file path (S3 key) if successful, null if failed
 */
export const uploadFileToS3 = async (file: File, prefix?: string): Promise<string | null> => {
  try {
    const { uploadUrl, key } = await callS3<{ uploadUrl: string; key: string }>(
      'presign-upload',
      {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        prefix,
        scope: SCOPE,
      }
    );

    console.log(`Uploading file to S3: ${key}`);

    // Upload directly to S3 with the presigned URL (keeps large file bodies out
    // of our serverless function).
    const response = await fetch(uploadUrl, {
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
    return key;
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    return null;
  }
};

/**
 * Get a presigned GET URL for a file.
 * @param filePath The file path (S3 key)
 * @returns The signed URL if successful, null if failed
 */
export const getSignedUrl = async (filePath: string): Promise<string | null> => {
  try {
    const { url } = await callS3<{ url: string }>('presign-download', {
      key: filePath,
      scope: SCOPE,
    });
    return url;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return null;
  }
};

/**
 * Delete a file from S3.
 * @param filePath The file path (S3 key)
 * @returns true if successful, false if failed
 */
export const deleteFileFromS3 = async (filePath: string): Promise<boolean> => {
  try {
    await callS3('delete', { key: filePath, scope: SCOPE });
    console.log('File deleted successfully from S3:', filePath);
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    return false;
  }
};

/**
 * Delete an entire folder from S3 by prefix.
 * Useful when deleting an RFQ and all of its associated files.
 * @param folderPrefix The folder prefix to delete (e.g., "RFQ-12345678-1/")
 * @returns true if any object was deleted, false otherwise
 */
export const deleteFolderFromS3 = async (folderPrefix: string): Promise<boolean> => {
  try {
    console.log(`Attempting to delete folder with prefix: ${folderPrefix}`);
    const { success } = await callS3<{ success: boolean; deletedCount: number }>(
      'delete-folder',
      { prefix: folderPrefix, scope: SCOPE }
    );
    return !!success;
  } catch (error) {
    console.error('Error deleting folder from S3:', error);
    return false;
  }
};
