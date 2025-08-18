import React, { useState } from 'react';
import { FormikProps } from 'formik';
import { Upload, X, Info, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';

interface StepFileUploadProps {
  formikProps: FormikProps<any>;
}

const StepFileUpload: React.FC<StepFileUploadProps> = ({ formikProps }) => {
  const { values, errors, touched, setFieldValue } = formikProps;
  const { toast } = useToast();
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      try {
        const fileList = Array.from(e.target.files);
        // Validate file size - max 50MB per file
        const invalidFiles = fileList.filter(file => file.size > 50 * 1024 * 1024);
        
        if (invalidFiles.length > 0) {
          toast({
            title: "File size exceeded",
            description: `Some files exceed the 50MB limit: ${invalidFiles.map(f => f.name).join(', ')}`,
            variant: "destructive"
          });
          // Filter out invalid files
          const validFiles = fileList.filter(file => file.size <= 50 * 1024 * 1024);
          setFieldValue('files', [...values.files, ...validFiles]);
        } else {
          setFieldValue('files', [...values.files, ...fileList]);
          console.log('Files added:', fileList);
        }
      } catch (error) {
        console.error('Error handling file upload:', error);
        toast({
          title: "Upload error",
          description: "There was an error processing your files. Please try again.",
          variant: "destructive"
        });
      }
    }
  };

  const handleAdditionalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      try {
        const fileList = Array.from(e.target.files);
        // Validate file size - max 50MB per file
        const invalidFiles = fileList.filter(file => file.size > 50 * 1024 * 1024);
        
        if (invalidFiles.length > 0) {
          toast({
            title: "File size exceeded",
            description: `Some files exceed the 50MB limit: ${invalidFiles.map(f => f.name).join(', ')}`,
            variant: "destructive"
          });
          // Filter out invalid files
          const validFiles = fileList.filter(file => file.size <= 50 * 1024 * 1024);
          setFieldValue('additionalFiles', [...values.additionalFiles, ...validFiles]);
        } else {
          setFieldValue('additionalFiles', [...values.additionalFiles, ...fileList]);
          console.log('Additional files added:', fileList);
        }
      } catch (error) {
        console.error('Error handling additional file upload:', error);
        toast({
          title: "Upload error",
          description: "There was an error processing your files. Please try again.",
          variant: "destructive"
        });
      }
    }
  };

  const removeFile = (index: number) => {
    const newFiles = [...values.files];
    newFiles.splice(index, 1);
    setFieldValue('files', newFiles);
  };

  const removeAdditionalFile = (index: number) => {
    const newFiles = [...values.additionalFiles];
    newFiles.splice(index, 1);
    setFieldValue('additionalFiles', newFiles);
  };

  const acceptedFileTypes = ".stp,.step,.stl,.obj,.dxf,.pdf,.png,.jpg,.jpeg,.tiff";
  
  return (
    <div className="space-y-8">
      <h3 className="text-xl font-medium mb-6">Upload General Files</h3>
      
      <div className="mb-8">
        <div 
          className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"
          onClick={() => document.getElementById('file-upload')?.click()}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            multiple
            accept={acceptedFileTypes}
            onChange={handleFileChange}
          />
          <Upload className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">
            <span className="font-medium text-teal-600">Click to upload</span> or drag and drop
          </p>
          <p className="mt-1 text-xs text-gray-500">
            STP, STEP, STL, OBJ, DXF, PDF, PNG, JPG (Max 50MB per file)
          </p>
          <p className="mt-2 text-xs text-gray-500">
            These are general files for the entire request. You can assign specific files to parts in the next step.
          </p>
        </div>

        {touched.files && errors.files && (
          <div className="text-red-500 text-sm mt-2">
            {typeof errors.files === 'string' ? errors.files : 'Please upload at least one file'}
          </div>
        )}
        
        {values.files.length > 0 && (
          <div className="mt-6">
            <h4 className="font-medium text-sm mb-2">General Files:</h4>
            <div className="space-y-2">
              {values.files.map((file: File, index: number) => (
                <div 
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-md"
                >
                  <div className="flex items-center">
                    <div className="bg-teal-100 p-2 rounded-md">
                      <FileText className="h-5 w-5 text-teal-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-900 truncate max-w-xs">
                        {file.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button 
                    type="button"
                    onClick={() => removeFile(index)}
                    className="text-gray-400 hover:text-red-500"
                    aria-label="Remove file"
                  >
                    <X size={20} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-start space-x-3">
          <Checkbox 
            id="additionalFilesCheck"
            checked={values.additionalFilesCheck} 
            onCheckedChange={(checked) => setFieldValue('additionalFilesCheck', checked)}
          />
          <div>
            <Label htmlFor="additionalFilesCheck" className="text-sm font-medium text-gray-900">
              Add additional information file
            </Label>
            <p className="text-xs text-gray-500">Add documentation, assembly drawings, or other specifications</p>
          </div>
        </div>
        
        {values.additionalFilesCheck && (
          <div className="ml-7 mt-2">
            <div 
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"
              onClick={() => document.getElementById('additional-file-upload')?.click()}
            >
              <input
                type="file"
                id="additional-file-upload"
                className="hidden"
                multiple
                accept=".pdf,.doc,.docx,.xlsx,.xls,.png,.jpg,.jpeg"
                onChange={handleAdditionalFileChange}
              />
              <Upload className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-1 text-sm text-gray-600">
                <span className="font-medium text-teal-600">Upload</span> additional files
              </p>
            </div>

            {values.additionalFiles.length > 0 && (
              <div className="mt-4">
                <h4 className="font-medium text-sm mb-2">Additional Files:</h4>
                <div className="space-y-2">
                  {values.additionalFiles.map((file: File, index: number) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded-md"
                    >
                      <div className="flex items-center">
                        <div className="bg-blue-100 p-1 rounded-md">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke="#1E40AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M14 2V8H20" stroke="#1E40AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M16 13H8" stroke="#1E40AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M16 17H8" stroke="#1E40AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M10 9H9H8" stroke="#1E40AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <p className="ml-2 text-sm font-medium text-gray-900 truncate max-w-xs">
                          {file.name}
                        </p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => removeAdditionalFile(index)}
                        className="text-gray-400 hover:text-red-500"
                        aria-label="Remove file"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className="space-y-4 pt-4">
        <div>
          <Label htmlFor="generalNotes">
            Note for the Whole Request <span className="text-gray-500">(optional)</span>
          </Label>
          <Textarea
            id="generalNotes"
            name="generalNotes"
            value={values.generalNotes}
            onChange={formikProps.handleChange}
            placeholder="Additional details or requirements for this quote request..."
            rows={4}
          />
        </div>
        
        <div>
          <Label htmlFor="internalRequestNumber" className="flex items-center">
            <span>Internal Request Number</span>
            <span className="text-gray-500 text-xs ml-2">(optional)</span>
            <Dialog>
              <DialogTrigger asChild>
                <button type="button" className="ml-2 text-gray-500 hover:text-teal-600">
                  <Info size={16} />
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Internal Request Number</DialogTitle>
                </DialogHeader>
                <div className="text-sm text-gray-600">
                  <p>This is your own internal reference number for this quote request.</p>
                  <p className="mt-2">If your company uses specific reference numbers for tracking projects or purchase requests, you can enter it here. This will be included in all communications regarding this quote.</p>
                </div>
              </DialogContent>
            </Dialog>
          </Label>
          <Input
            id="internalRequestNumber"
            name="internalRequestNumber"
            value={values.internalRequestNumber}
            onChange={formikProps.handleChange}
            placeholder="Your internal reference number..."
          />
        </div>
      </div>

      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              Please upload CAD files in any common format. STL, STEP, and IGES files are preferred as they contain the most complete 3D information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepFileUpload;
