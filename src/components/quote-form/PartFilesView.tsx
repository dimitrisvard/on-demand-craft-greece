import React from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileText, Folder } from 'lucide-react';
import { downloadAndSaveFile } from '@/utils/fileStorage';

interface File {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  part_id?: string;
}

interface Part {
  id: string;
  name: string;
  files: File[];
}

interface PartFilesViewProps {
  parts: Part[];
}

const PartFilesView: React.FC<PartFilesViewProps> = ({ parts }) => {
  const handleDownloadFile = async (file: File) => {
    try {
      await downloadAndSaveFile(file.file_path, file.file_name);
    } catch (err) {
      console.error('Error downloading file:', err);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch(extension) {
      case 'pdf': return <FileText className="h-4 w-4 text-red-500" />;
      case 'doc': case 'docx': return <FileText className="h-4 w-4 text-blue-500" />;
      case 'xls': case 'xlsx': return <FileText className="h-4 w-4 text-green-500" />;
      case 'jpg': case 'jpeg': case 'png': case 'gif': return <FileText className="h-4 w-4 text-purple-500" />;
      default: return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {parts.map((part) => (
        <div key={part.id} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">{part.name}</h3>
            <div className="flex items-center text-sm text-gray-500">
              <Folder className="h-4 w-4 mr-1" />
              {part.files.length} files
            </div>
          </div>
          
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {part.files.map((file) => (
              <div 
                key={file.id} 
                className="flex justify-between items-center p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100"
              >
                <div className="flex items-center space-x-3">
                  {getFileIcon(file.file_name)}
                  <div>
                    <p className="font-medium text-sm">{file.file_name}</p>
                    <p className="text-xs text-gray-500">{formatFileSize(file.file_size)}</p>
                  </div>
                </div>
                
                <Button 
                  variant="outline" 
                  size="sm"
                  className="flex items-center space-x-1"
                  onClick={() => handleDownloadFile(file)}
                >
                  <Download className="h-4 w-4" />
                  <span>Download</span>
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PartFilesView; 