import { supabase } from "@/integrations/supabase/client";
import { uploadFileToS3, getSignedUrl, deleteFileFromS3 } from './awsS3Storage';

const BUCKET_NAME = 'rfq-files';

/**
 * Upload a file to S3 and store metadata in Supabase
 * @param file The file to upload
 * @param rfqId The RFQ ID to associate the file with
 * @param partId Optional part ID if the file is specific to a part
 * @returns Object with path and success status
 */
export const uploadRfqFile = async (
  file: File,
  rfqId: string,
  partId?: string
): Promise<{ path: string | null; success: boolean; error?: any }> => {
  try {
    console.log(`Starting upload process for file: ${file.name} (${file.size} bytes)`);
    console.log(`Upload destination: rfqId=${rfqId}, partId=${partId || 'none'}`);
    
    // Build the file path - organize by RFQ ID and optionally by part ID
    const folderPath = partId 
      ? `${rfqId}/${partId}` 
      : rfqId;
    
    // Upload to S3
    const filePath = await uploadFileToS3(file, folderPath);
    
    if (!filePath) {
      console.error('Failed to upload file to S3:', file.name);
      return { path: null, success: false, error: new Error('Failed to upload file to S3') };
    }
    
    // Store the file metadata in Supabase database
    const fileData = {
      rfq_id: rfqId,
      part_id: partId || null,
      file_name: file.name,
      file_path: filePath,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size
    };
    
    console.log('Saving file metadata to database:', fileData);
    
    const { error: dbError } = await supabase
      .from('rfq_files')
      .insert(fileData);
    
    if (dbError) {
      console.error('Error saving file metadata to database:', dbError);
      return { path: filePath, success: false, error: dbError };
    }
    
    console.log('File metadata saved successfully');

    // Trigger async STEP→GLB conversion (fire-and-forget, non-blocking)
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.step') || lowerName.endsWith('.stp')) {
      triggerStepConversion(filePath).catch((err) =>
        console.warn('STEP→GLB conversion failed (non-blocking):', err)
      );
    }

    return { path: filePath, success: true };
  } catch (error) {
    console.error('Exception during file upload:', error);
    return { path: null, success: false, error };
  }
};

/**
 * Trigger server-side STEP→GLB conversion (async, non-blocking).
 * The converted GLB is stored in the same S3 folder as the original STEP.
 * The viewer will use the GLB if available, falling back to client-side STEP parsing.
 */
async function triggerStepConversion(filePath: string): Promise<void> {
  try {
    const response = await fetch('/api/convert-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn('STEP conversion response:', response.status, data);
    } else {
      const data = await response.json();
      console.log('STEP→GLB conversion complete:', data.glbPath);
    }
  } catch (err) {
    console.warn('STEP conversion request failed:', err);
  }
}

/**
 * Get a list of files for a specific RFQ or part
 * @param rfqId The RFQ ID to get files for
 * @param partId Optional part ID to filter by
 * @returns Array of file metadata objects
 */
export const getRfqFiles = async (rfqId: string, partId?: string) => {
  try {
    console.log(`Fetching files for rfqId=${rfqId}, partId=${partId || 'none'}`);
    
    let query = supabase
      .from('rfq_files')
      .select('*')
      .eq('rfq_id', rfqId);
    
    if (partId) {
      query = query.eq('part_id', partId);
    }
    
    const { data, error, count } = await query.order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching RFQ files from database:', error);
      return [];
    }
    
    console.log(`Retrieved ${count || data?.length || 0} files from database`);
    if (data && data.length > 0) {
      console.log('Sample file data:', data[0]);
    }
    
    return data || [];
  } catch (error) {
    console.error('Exception fetching RFQ files:', error);
    return [];
  }
};

/**
 * Download a file by its path
 * @param path The file path in S3
 * @param fileName The name to save the file as
 * @returns Promise that resolves when download is complete
 */
export const downloadAndSaveRfqFile = async (path: string, fileName: string): Promise<void> => {
  try {
    console.log(`Downloading file from S3: ${path}`);
    
    // Get signed URL from S3
    const signedUrl = await getSignedUrl(path);
    
    if (!signedUrl) {
      throw new Error('Failed to generate signed URL for file');
    }
    
    // Create a temporary link and trigger download
    const link = document.createElement('a');
    link.href = signedUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
};

/**
 * Get a signed URL for a file
 * @param path The file path in S3
 * @param expiresIn Seconds until URL expires (default: 3600)
 * @returns The signed URL for the file
 */
export const getRfqFileUrl = async (path: string, expiresIn: number = 3600): Promise<string> => {
  try {
    const url = await getSignedUrl(path);
    if (!url) {
      throw new Error('Failed to generate signed URL for file');
    }
    return url;
  } catch (error) {
    console.error('Error getting file URL:', error);
    throw error;
  }
};

/**
 * Delete an RFQ file from S3 and Supabase
 * @param path The file path in S3
 * @param fileId The database ID for the file record
 */
export const deleteRfqFile = async (path: string, fileId: string): Promise<boolean> => {
  try {
    console.log(`Attempting to delete file: ${path}, ID: ${fileId}`);
    
    // Delete from S3
    const s3Success = await deleteFileFromS3(path);
    
    if (!s3Success) {
      console.error('Failed to delete file from S3:', path);
      return false;
    }
    
    // Delete from Supabase database
    const { error: dbError } = await supabase
      .from('rfq_files')
      .delete()
      .eq('id', fileId);
    
    if (dbError) {
      console.error('Error deleting file record from database:', dbError);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Exception during file deletion:', error);
    return false;
  }
};

/**
 * Upload multiple files for an RFQ part and save their metadata
 * @param files Array of files to upload
 * @param rfqId RFQ ID
 * @param partId Part ID
 * @returns Array of upload results
 */
export const uploadFilesForRfqPart = async (
  files: File[],
  rfqId: string,
  partId: string
): Promise<{ success: boolean; uploadedCount: number; results: any[] }> => {
  if (!files.length) {
    return { success: false, uploadedCount: 0, results: [] };
  }
  
  console.log(`Bulk uploading ${files.length} files for rfqId=${rfqId}, partId=${partId}`);
  const results = [];
  let successCount = 0;
  
  try {
    for (const file of files) {
      const result = await uploadRfqFile(file, rfqId, partId);
      results.push(result);
      
      if (result.success) {
        successCount++;
      }
    }
    
    return {
      success: successCount > 0,
      uploadedCount: successCount,
      results
    };
  } catch (error) {
    console.error('Error in bulk file upload:', error);
    return {
      success: successCount > 0,
      uploadedCount: successCount,
      results
    };
  }
};

/**
 * Check if files exist for an RFQ part
 * @param rfqId RFQ ID
 * @param partId Part ID
 * @returns Boolean indicating if files exist
 */
export const checkFilesExistForPart = async (
  rfqId: string,
  partId: string
): Promise<boolean> => {
  try {
    const { data, error, count } = await supabase
      .from('rfq_files')
      .select('*', { count: 'exact' })
      .eq('rfq_id', rfqId)
      .eq('part_id', partId);
    
    if (error) {
      console.error('Error checking files for part:', error);
      return false;
    }
    
    return count ? count > 0 : false;
  } catch (error) {
    console.error('Exception checking files for part:', error);
    return false;
  }
};

/**
 * Download all files for an RFQ as a zip
 * @param rfqId The RFQ ID to download files for
 * @param rfqNumber The RFQ number for file naming
 * @returns Promise that resolves when download is complete
 */
export const downloadAllRfqFiles = async (rfqId: string, rfqNumber: string): Promise<void> => {
  try {
    // Use JSZip library to create a zip file in the browser
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    
    console.log(`Downloading all files for RFQ: ${rfqNumber} (${rfqId})`);
    
    // Get all files for this RFQ
    const files = await getRfqFiles(rfqId);
    
    if (!files || files.length === 0) {
      console.log('No files found for RFQ:', rfqNumber);
      // Instead of throwing an error, create an empty zip with a README
      zip.file('README.txt', `No files were found for RFQ: ${rfqNumber}.\nPlease upload files to this RFQ first.`);
    } else {
      // Create a promise for each file download
      const downloadPromises = files.map(async (file) => {
        try {
          // Get signed URL for the file
          const signedUrl = await getSignedUrl(file.file_path);
          
          if (!signedUrl) {
            console.error(`Failed to get signed URL for ${file.file_name}`);
            return null;
          }
          
          // Fetch the file content
          const response = await fetch(signedUrl);
          
          if (!response.ok) {
            console.error(`Failed to download ${file.file_name}: ${response.statusText}`);
            return null;
          }
          
          // Get the blob content
          const blob = await response.blob();
          
          // Preserve the exact S3 path structure for the zip file
          // Extract the path after the rfqNumber prefix to maintain the folder structure
          let zipPath = '';
          
          if (file.file_path) {
            // Example path: rfq-files/RFQ-08052025-2/part-Part-1/filename.ext
            // Extract just the part after the RFQ number
            const pathParts = file.file_path.split('/');
            
            // Find the index of the part containing the RFQ number
            const rfqIndex = pathParts.findIndex(part => part.includes(rfqNumber));
            
            if (rfqIndex >= 0 && rfqIndex < pathParts.length - 1) {
              // Extract all parts after the RFQ folder to preserve structure
              zipPath = pathParts.slice(rfqIndex + 1).join('/');
              
              // If we just have the filename without folders, make sure we have the part folder
              if (!zipPath.includes('/') && file.part_id) {
                // Use the S3 folder structure with part-Part-X format from the file path
                const partFolderMatch = file.file_path.match(/part-[^/]+/);
                if (partFolderMatch) {
                  zipPath = `${partFolderMatch[0]}/${file.file_name}`;
                }
              }
            }
            
            // If we couldn't extract a path, just use the filename
            if (!zipPath) {
              zipPath = file.file_name;
            }
          } else {
            zipPath = file.file_name;
          }
          
          // Add the file to the zip
          zip.file(zipPath, blob);
          
          return file.file_name;
        } catch (err) {
          console.error(`Error downloading file ${file.file_name}:`, err);
          return null;
        }
      });
      
      // Wait for all downloads to complete
      const results = await Promise.all(downloadPromises);
      const successfulDownloads = results.filter(Boolean);
      
      if (successfulDownloads.length === 0) {
        // If no files were downloaded successfully, add a README
        zip.file('README.txt', `Failed to download any files for RFQ: ${rfqNumber}.\nPlease check the console for error details.`);
      }
    }
    
    // Generate the zip file
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    // Create a download link
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `${rfqNumber}-Files.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log(`Zip file created for RFQ: ${rfqNumber}`);
  } catch (error) {
    console.error('Error downloading all files:', error);
    throw error;
  }
};
