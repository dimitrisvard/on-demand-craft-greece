import { supabase } from "@/integrations/supabase/client";

/**
 * Uploads a file to a specific bucket in Supabase Storage
 * @param file The file to upload
 * @param bucket The bucket name (e.g., 'blog-images')
 * @param path The path in the bucket (optional folder structure)
 * @returns The public URL of the uploaded file or null if failed
 */
export const uploadToBucket = async (file: File, bucket: string, path: string = ''): Promise<string | null> => {
  try {
    // Sanitize filename
    const fileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = path ? `${path}/${fileName}` : fileName;
    const uniquePath = `${Date.now()}_${filePath}`; // Ensure uniqueness
    
    // Check/Create bucket
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === bucket);
    
    if (!bucketExists) {
      const { error: createError } = await supabase.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: 10485760 // 10MB for images
      });
      if (createError) {
        console.error(`Error creating bucket ${bucket}:`, createError);
        return null;
      }
      // Make public
      await supabase.storage.updateBucket(bucket, { public: true });
    }

    // Upload
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(uniquePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading file:', uploadError);
      return null;
    }

    // Get Public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(uniquePath);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Exception during upload:', error);
    return null;
  }
};

/**
 * Lists files in a specific bucket
 * @param bucket The bucket name
 * @param path Optional folder path
 * @returns Array of file objects
 */
export const listFiles = async (bucket: string, path: string = '') => {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(path, {
        limit: 100,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (error) {
      // If bucket doesn't exist, return empty
      if (error.message.includes("The resource was not found")) return [];
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error(`Error listing files in ${bucket}:`, error);
    return [];
  }
};

