import React, { useState, useEffect } from 'react';
import { Upload, X, CheckCircle, Loader2 } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { Button } from '../../components/ui/button';
import { uploadRfqFile } from '../../utils/rfqFileStorage';

interface RfqFileUploadProps {
  rfqId: string;
  partId?: string;
  onFileUploaded?: (path: string) => void;
  onUploadComplete?: (success: boolean) => void;
  onFilesSelected?: (files: File[]) => void;
  autoUpload?: boolean;
}

const RfqFileUpload: React.FC<RfqFileUploadProps> = ({ 
  rfqId, 
  partId, 
  onFileUploaded,
  onUploadComplete,
  onFilesSelected,
  autoUpload = true
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{[key: string]: number}>({});
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      console.log(`Selected ${newFiles.length} files:`, newFiles.map(f => `${f.name} (${f.size} bytes)`));
      
      setFiles(newFiles);
      
      if (onFilesSelected) {
        onFilesSelected(newFiles);
      }
      
      if (autoUpload) {
        handleUpload(newFiles);
      }
    }
  };

  const removeFile = (index: number) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    setFiles(newFiles);
    
    if (onFilesSelected) {
      onFilesSelected(newFiles);
    }
  };

  const handleUpload = async (filesToUpload = files) => {
    if (!filesToUpload.length) {
      toast({
        title: "No files selected",
        description: "Please select at least one file to upload",
        variant: "destructive",
      });
      return;
    }

    if (!rfqId) {
      toast({
        title: "Missing RFQ ID",
        description: "An RFQ ID is required to upload files",
        variant: "destructive",
      });
      return;
    }

    console.log(`Starting upload of ${filesToUpload.length} files to rfqId=${rfqId}, partId=${partId || 'none'}`);
    setIsUploading(true);
    let successCount = 0;
    const uploadResults: {path: string | null; success: boolean; error?: any}[] = [];

    try {
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));
        
        const progressInterval = setInterval(() => {
          setUploadProgress(prev => {
            if (prev[file.name] >= 90) return prev;
            return { ...prev, [file.name]: Math.min(90, (prev[file.name] || 0) + 10) };
          });
        }, 300);

        console.log(`Uploading file: ${file.name} (${file.size} bytes)`);
        const result = await uploadRfqFile(file, rfqId, partId);
        uploadResults.push(result);
        
        clearInterval(progressInterval);
        
        if (result.success && result.path) {
          console.log(`Upload successful. Path: ${result.path}`);
          setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
          successCount++;
          
          if (onFileUploaded) {
            onFileUploaded(result.path);
          }
        } else {
          console.error(`Upload failed:`, result.error);
          setUploadProgress(prev => ({ ...prev, [file.name]: -1 }));
          toast({
            title: "Upload failed",
            description: `Failed to upload ${file.name}: ${result.error?.message || 'Unknown error'}`,
            variant: "destructive",
          });
        }
      }

      if (successCount === filesToUpload.length) {
        toast({
          title: "Upload complete",
          description: `Successfully uploaded ${successCount} file${successCount !== 1 ? 's' : ''}`,
        });
        setFiles([]);
      } else {
        toast({
          title: "Upload partially complete",
          description: `Uploaded ${successCount} of ${filesToUpload.length} files`,
          variant: successCount > 0 ? "default" : "destructive",
        });
      }
      
      if (onUploadComplete) {
        console.log(`Calling onUploadComplete with success=${successCount > 0}`);
        onUploadComplete(successCount > 0);
      }
    } catch (error: any) {
      console.error("Error uploading files:", error);
      toast({
        title: "Upload error",
        description: `An unexpected error occurred: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
      
      if (onUploadComplete) {
        onUploadComplete(false);
      }
    } finally {
      setIsUploading(false);
    }
    
    return uploadResults;
  };

  return (
    <div className="space-y-4">
      <div 
        className={`border-2 border-dashed rounded-lg p-6 text-center ${
          isUploading ? 'bg-gray-50 opacity-75 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'
        }`}
        onClick={() => !isUploading && document.getElementById("rfq-file-input")?.click()}
      >
        <input
          type="file"
          id="rfq-file-input"
          className="hidden"
          multiple
          onChange={handleFileChange}
          disabled={isUploading}
          accept=".pdf,.stl,.step,.stp,.igs,.iges,.obj,.dxf,.dwg,.png,.jpg,.jpeg,.tiff"
        />
        <Upload className="mx-auto h-12 w-12 text-gray-400" />
        <p className="mt-2 text-sm font-medium text-gray-700">
          {isUploading ? 'Uploading...' : 'Drop files here or click to upload'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Supported formats: PDF, STL, STEP, STP, PNG, JPG, etc.
          <br />
          Maximum file size: 50MB
        </p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Selected Files:</p>
          {files.map((file, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-50 border rounded-md">
              <div className="flex items-center space-x-3 truncate">
                <div className="flex-shrink-0">
                  {isUploading ? (
                    uploadProgress[file.name] === 100 ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : uploadProgress[file.name] === -1 ? (
                      <X className="h-5 w-5 text-red-500" />
                    ) : (
                      <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                    )
                  ) : (
                    <div className="h-5 w-5 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 text-xs">{index + 1}</span>
                    </div>
                  )}
                </div>
                <div className="truncate">
                  <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeFile(index)}
                disabled={isUploading}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RfqFileUpload;
