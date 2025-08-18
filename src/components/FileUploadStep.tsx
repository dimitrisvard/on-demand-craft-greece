
import React, { useState, useCallback } from 'react';
import { CloudUpload, FileText, X, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FileUploadStepProps {
  files: File[];
  updateFormState: (field: string, value: any) => void;
  currentPart?: number;
  isAddingToPart?: boolean;
}

const FileUploadStep: React.FC<FileUploadStepProps> = ({ 
  files, 
  updateFormState, 
  currentPart,
  isAddingToPart = false 
}) => {
  const [dragActive, setDragActive] = useState(false);
  const { toast } = useToast();

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files);
      
      if (isAddingToPart && currentPart !== undefined) {
        // Adding files to a specific part
        updateFormState('partFiles', { partIndex: currentPart, files: newFiles });
      } else {
        // Regular file upload for step 1
        updateFormState('files', newFiles);
      }
    }
  }, [updateFormState, isAddingToPart, currentPart]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      
      if (isAddingToPart && currentPart !== undefined) {
        // Adding files to a specific part
        updateFormState('partFiles', { partIndex: currentPart, files: newFiles });
      } else {
        // Regular file upload for step 1
        updateFormState('files', newFiles);
      }
    }
  };

  const removeFile = (index: number) => {
    const updatedFiles = [...files];
    updatedFiles.splice(index, 1);
    updateFormState('files', updatedFiles);
  };

  return (
    <div>
      <h3 className="text-xl font-bold mb-4">
        {isAddingToPart ? `Upload Files for Part ${currentPart! + 1}` : "Upload Files"}
      </h3>
      
      {!isAddingToPart && (
        <div className="mb-6">
          <img 
            src="/lovable-uploads/f239043e-a42b-4b5f-8fa3-8c964cdf24ab.png" 
            alt="CAD File Upload Illustration" 
            className="w-full max-w-md mx-auto my-4 h-auto"
          />
        </div>
      )}
      
      <div 
        className={`border-2 border-dashed rounded-lg p-8 text-center mb-6 ${
          dragActive ? 'border-teal-500 bg-teal-50' : 'border-gray-300'
        }`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id={isAddingToPart ? `file-upload-part-${currentPart}` : "file-upload"}
          className="hidden"
          onChange={handleFileChange}
          accept=".stl,.step,.stp,.iges,.igs,.obj,.dxf,.dwg,.pdf,.png,.jpg,.jpeg,.tif,.tiff"
          multiple
        />
        
        <CloudUpload className="mx-auto h-16 w-16 text-teal-600 mb-4" />
        
        <h4 className="text-lg font-medium mb-2">Drag & Drop</h4>
        
        <p className="text-gray-600 mb-6">
          Upload your CAD files in any common format (STL, STEP, etc.) and<br />
          receive an instant quote with detailed pricing breakdown.
        </p>
        
        <div className="text-gray-400 mb-6">or</div>
        
        <label htmlFor={isAddingToPart ? `file-upload-part-${currentPart}` : "file-upload"} className="cursor-pointer">
          <span className="bg-teal-600 text-white px-6 py-3 rounded-md hover:bg-teal-700 transition-colors">
            Select file
          </span>
        </label>
      </div>

      {files.length > 0 && (
        <div className="border rounded-md p-4 bg-gray-50 mb-6">
          <h4 className="font-medium mb-3">Uploaded Files</h4>
          <div className="space-y-2">
            {files.map((file, index) => (
              <div key={index} className="flex justify-between items-center bg-white p-3 rounded border">
                <div className="flex items-center">
                  <FileText className="text-teal-600 mr-3" size={20} />
                  <div>
                    <p className="font-medium">{file.name}</p>
                    <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button 
                  onClick={() => removeFile(index)}
                  className="text-gray-500 hover:text-red-500"
                  type="button"
                >
                  <X size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isAddingToPart && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-700">
                For the most accurate quote, please provide both 3D model files and technical drawings if available.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUploadStep;
