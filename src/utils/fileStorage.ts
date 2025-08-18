import { supabase } from "@/integrations/supabase/client";

/**
 * Uploads a file to Supabase Storage
 * @param file The file to upload
 * @param path The path in the bucket where the file will be stored
 * @returns The full path of the uploaded file or null if failed
 */
export const uploadFile = async (file: File, path: string): Promise<string | null> => {
  try {
    const filePath = `${path}/${file.name}`;
    
    // First check if the bucket exists, if not create it
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    
    if (bucketsError) {
      console.error('Error checking buckets:', bucketsError);
      return null;
    }
    
    const bucketExists = buckets.some(bucket => bucket.name === 'rfq-files');
    
    if (!bucketExists) {
      console.log('Creating rfq-files bucket as public...');
      const { error: createError } = await supabase.storage.createBucket('rfq-files', {
        public: true, // Make the bucket public
        fileSizeLimit: 52428800 // 50MB
      });
      
      if (createError) {
        console.error('Error creating bucket:', createError);
        return null;
      }
      
      // Update bucket to public which should be sufficient
      const { error: policyError } = await supabase.storage.updateBucket('rfq-files', {
        public: true,
        fileSizeLimit: 52428800 // 50MB
      });
      
      if (policyError) {
        console.error('Error updating bucket policy:', policyError);
      } else {
        console.log('Updated bucket to public access successfully');
      }
    } else {
      // Ensure the bucket is public if it exists
      const { error: updateError } = await supabase.storage.updateBucket('rfq-files', {
        public: true
      });
      
      if (updateError) {
        console.error('Error updating bucket to public:', updateError);
      } else {
        console.log('Bucket updated to public access');
      }
    }
    
    console.log('Uploading file to path:', filePath);
    
    // Upload the file to the bucket
    const { data, error } = await supabase.storage
      .from('rfq-files')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Error uploading file:', error);
      return null;
    }

    console.log('File uploaded successfully:', data);
    return data.path;
  } catch (error) {
    console.error('Exception during file upload:', error);
    return null;
  }
};

/**
 * Get a public URL for a file in storage
 * @param path The path of the file in storage
 * @returns The public URL of the file
 */
export const getFileUrl = (path: string): string => {
  if (!path) return '';
  
  const { data } = supabase.storage
    .from('rfq-files')
    .getPublicUrl(path);
  
  console.log('Generated public URL for path:', path, 'URL:', data.publicUrl);
  return data.publicUrl;
};

/**
 * Downloads a file from Supabase Storage
 * @param path The path of the file in storage
 * @returns The blob of the file or null if failed
 */
export const downloadFile = async (path: string): Promise<Blob | null> => {
  try {
    if (!path) {
      console.error('No file path provided');
      throw new Error('No file path provided');
    }
    
    console.log('Downloading file from path:', path);
    
    // Check if the file exists in storage
    const { data: fileExists, error: existsError } = await supabase.storage
      .from('rfq-files')
      .list(path.split('/').slice(0, -1).join('/'));
      
    if (existsError) {
      console.error('Error checking file existence:', existsError);
    }
    
    if (!fileExists || fileExists.length === 0) {
      console.error('File not found in storage:', path);
    } else {
      console.log('File exists in storage:', fileExists);
    }
    
    const { data, error } = await supabase.storage
      .from('rfq-files')
      .download(path);

    if (error) {
      console.error('Error downloading file:', error);
      throw new Error(`Failed to download file: ${error.message}`);
    }

    if (!data) {
      console.error('No data received from storage for path:', path);
      throw new Error('No data received from storage');
    }

    console.log('File downloaded successfully from path:', path);
    return data;
  } catch (error) {
    console.error('Exception during file download:', error);
    throw error;
  }
};

/**
 * Downloads and triggers browser download for a file
 * @param path The file path in storage
 * @param customFileName Optional custom file name for the download
 */
export const downloadAndSaveFile = async (path: string, fileName?: string) => {
  try {
    if (!path) {
      console.error('No file path provided for download');
      throw new Error('No file path provided');
    }
    
    console.log('Downloading and saving file:', path);
    
    // Get file from bucket
    const blob = await downloadFile(path);
      
    if (!blob) {
      console.error('Could not retrieve file from path:', path);
      throw new Error('Could not retrieve file');
    }
    
    // Create blob URL and trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || path.split('/').pop() || 'download';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    console.log('File download complete for:', fileName || path.split('/').pop());
    return true;
  } catch (error: any) {
    console.error('Error downloading file:', error);
    throw new Error(error.message || 'Failed to download file');
  }
};

/**
 * Checks if a storage bucket exists and creates it if it doesn't
 * @returns Boolean indicating if the bucket exists or was created successfully
 */
export const ensureStorageBucketExists = async (): Promise<boolean> => {
  try {
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    
    if (bucketsError) {
      console.error('Error checking buckets:', bucketsError);
      return false;
    }
    
    const bucketExists = buckets.some(bucket => bucket.name === 'rfq-files');
    
    if (!bucketExists) {
      console.log('Creating rfq-files bucket as public...');
      const { error: createError } = await supabase.storage.createBucket('rfq-files', {
        public: true,
        fileSizeLimit: 52428800 // 50MB
      });
      
      if (createError) {
        console.error('Error creating bucket:', createError);
        return false;
      }
      
      console.log('Bucket created successfully');
      return true;
    }
    
    console.log('Bucket already exists');
    return true;
  } catch (error) {
    console.error('Exception checking/creating bucket:', error);
    return false;
  }
};
