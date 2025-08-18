import React, { useState, useEffect } from 'react';
import { FileText, Trash2, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getRfqFiles, deleteRfqFile, downloadAndSaveRfqFile } from '@/utils/rfqFileStorage';
import ErrorBoundary from '@/components/ErrorBoundary';

interface FileItem {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  rfq_id: string;
  part_id: string | null;
  created_at: string;
}

interface RfqFileListProps {
  rfqId: string;
  partId?: string;
  onRefreshRequest?: () => void;
}

const RfqFileList: React.FC<RfqFileListProps> = ({ 
  rfqId, 
  partId, 
  onRefreshRequest 
}) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchFiles();
  }, [rfqId, partId]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      console.log(`Fetching files for rfqId=${rfqId}, partId=${partId || 'none'}`);
      const data = await getRfqFiles(rfqId, partId);
      console.log('Files fetched:', data);
      setFiles(data as FileItem[]);
    } catch (error) {
      console.error('Error fetching files:', error);
      toast({
        title: "Error",
        description: "Failed to load files",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (file: FileItem) => {
    setDownloadingFileId(file.id);
    try {
      console.log(`Downloading file: ${file.file_name}, path: ${file.file_path}`);
      await downloadAndSaveRfqFile(file.file_path, file.file_name);
      toast({
        title: "Success",
        description: `Downloaded ${file.file_name}`,
      });
    } catch (error: any) {
      console.error("Download error:", error);
      toast({
        title: "Download failed",
        description: error.message || "Failed to download file",
        variant: "destructive",
      });
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleDelete = async (file: FileItem) => {
    if (confirm(`Are you sure you want to delete ${file.file_name}?`)) {
      setDeletingFileId(file.id);
      try {
        console.log(`Deleting file: ${file.file_name}, id: ${file.id}, path: ${file.file_path}`);
        const success = await deleteRfqFile(file.file_path, file.id);
        
        if (success) {
          toast({
            title: "Success",
            description: `Deleted ${file.file_name}`,
          });
          
          // Refresh the file list
          fetchFiles();
          
          // Call the refresh callback if provided
          if (onRefreshRequest) {
            onRefreshRequest();
          }
        } else {
          throw new Error("Delete operation failed");
        }
      } catch (error: any) {
        console.error("Delete error:", error);
        toast({
          title: "Delete failed",
          description: error.message || "Failed to delete file",
          variant: "destructive",
        });
      } finally {
        setDeletingFileId(null);
      }
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const getFileIcon = (fileType: string) => {
    // Here you could add different icons based on file type
    return <FileText className="h-5 w-5 text-blue-500" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 border rounded-md">
        <div className="flex flex-col items-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="mt-2 text-sm">Loading files...</span>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 border rounded-md bg-gray-50">
        <FileText className="h-12 w-12 text-gray-400 mb-2" />
        <p className="text-gray-500">No files found</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="border rounded-md">
        <ul className="divide-y">
          {files.map((file) => (
            <li key={file.id} className="flex items-center justify-between p-4">
              <div className="flex items-center space-x-3">
                <div className="bg-gray-100 p-2 rounded-md">
                  {getFileIcon(file.file_type)}
                </div>
                <div>
                  <p className="font-medium text-sm">{file.file_name}</p>
                  <p className="text-xs text-gray-500">
                    {formatFileSize(file.file_size)} • {new Date(file.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(file)}
                  disabled={!!downloadingFileId}
                  className="h-8 w-8 p-0"
                >
                  {downloadingFileId === file.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(file)}
                  disabled={!!deletingFileId}
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                >
                  {deletingFileId === file.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </ErrorBoundary>
  );
};

export default RfqFileList;
