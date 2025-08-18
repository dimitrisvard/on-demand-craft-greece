
import React, { useState, useCallback } from 'react';
import { AlertTriangle, ChevronRight, Info, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { StepComponentProps, getErrorAsString } from './types';

const StepFileUpload: React.FC<StepComponentProps> = ({ formikProps }) => {
  const { values, errors, touched, handleChange, handleBlur, setFieldValue } = formikProps;
  const [dragActive, setDragActive] = useState(false);

  // Drag and drop handlers
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
      handleFiles(e.dataTransfer.files);
    }
  }, [setFieldValue, values.files]);

  const handleFiles = (files: FileList) => {
    const newFiles = Array.from(files);
    setFieldValue('files', [...values.files, ...newFiles]);
    console.log('Files uploaded:', files);
  };

  const removeFile = (index: number) => {
    const updatedFiles = [...values.files];
    updatedFiles.splice(index, 1);
    setFieldValue('files', updatedFiles);
  };

  return (
    <div className="space-y-8">
      <h3 className="text-xl font-medium mb-4">Upload CAD Files</h3>
      
      <div 
        className={`border-2 border-dashed rounded-lg p-8 text-center ${
          dragActive ? 'border-teal-500 bg-teal-50' : 'border-gray-300'
        }`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id="file-upload"
          className="hidden"
          multiple
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files);
            }
          }}
          accept=".stp,.step,.stl,.iges,.igs,.obj,.dxf,.dwg,.pdf"
        />
        
        <Upload className="mx-auto h-16 w-16 text-teal-600 mb-4" />
        
        <h4 className="text-lg font-medium mb-2">Drag & Drop Your Files Here</h4>
        
        <p className="text-gray-600 mb-6">
          Upload your CAD files in any common format (STL, STEP, etc.)
        </p>
        
        <div className="text-gray-400 mb-6">or</div>
        
        <label htmlFor="file-upload" className="cursor-pointer">
          <span className="bg-teal-600 text-white px-6 py-3 rounded-md hover:bg-teal-700 transition-colors">
            Browse Files
          </span>
        </label>
      </div>
      
      {touched.files && errors.files && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">
                {getErrorAsString(errors.files)}
              </p>
            </div>
          </div>
        </div>
      )}

      {values.files.length > 0 && (
        <div className="border rounded-md p-4">
          <h4 className="font-medium mb-4">Uploaded Files ({values.files.length})</h4>
          <div className="space-y-2">
            {values.files.map((file: File, index: number) => (
              <div key={index} className="flex justify-between items-center bg-gray-50 p-3 rounded-md border">
                <div className="flex items-center">
                  <div className="bg-teal-100 p-1.5 rounded-md">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="font-medium text-sm">{file.name}</p>
                    <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => removeFile(index)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label htmlFor="generalNotes">General Notes (Optional)</Label>
          <Textarea
            id="generalNotes"
            name="generalNotes"
            value={values.generalNotes}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="Any additional information or special requirements..."
            rows={4}
          />
        </div>
        
        <div>
          <Label htmlFor="internalRequestNumber">Your Internal Request Number (Optional)</Label>
          <Input
            id="internalRequestNumber"
            name="internalRequestNumber"
            value={values.internalRequestNumber}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="e.g. PO-12345"
          />
          <p className="text-xs text-gray-500 mt-1">
            If you have an internal reference number for this request, please provide it here.
          </p>
        </div>
      </div>
      
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
        <div className="flex">
          <div className="flex-shrink-0">
            <Info className="h-5 w-5 text-blue-400" />
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              For the most accurate quote, please provide both 3D model files and technical drawings if available.
              Supported file formats include STEP, STL, IGES, OBJ, DXF, DWG, and PDF.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepFileUpload;
