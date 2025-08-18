
import React, { useState, useEffect } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { downloadAndSaveRfqFile } from '@/utils/rfqFileStorage';
import { supabase } from '@/integrations/supabase/client';

interface RfqFileDownloadProps {
  fileName: string;
  filePath: string;
  fileType?: string;
  variant?: 'button' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  useSignedUrl?: boolean;
}

const RfqFileDownload: React.FC<RfqFileDownloadProps> = ({ 
  fileName, 
  filePath, 
  fileType,
  variant = 'button',
  size = 'md',
  useSignedUrl = false
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [fileExists, setFileExists] = useState<boolean | null>(null);
  const { toast } = useToast();

  // Check if the file actually exists in storage
  useEffect(() => {
    const checkFileExists = async () => {
      if (!filePath) {
        setFileExists(false);
        return;
      }

      try {
        // Extract folder path and filename
        const pathParts = filePath.split('/');
        const fileName = pathParts.pop() || '';
        const folderPath = pathParts.join('/');
        
        console.log(`Checking if file exists: folder=${folderPath}, filename=${fileName}`);
        
        const { data, error } = await supabase.storage
          .from('rfq-files')
          .list(folderPath, {
            limit: 100,
            search: fileName
          });
          
        if (error) {
          console.error("Error checking if file exists:", error);
          setFileExists(false);
          return;
        }
        
        const exists = data && data.some(item => item.name === fileName);
        console.log(`File ${fileName} ${exists ? 'exists' : 'does not exist'} in storage`);
        setFileExists(exists || false);
      } catch (error) {
        console.error("Error checking file existence:", error);
        setFileExists(false);
      }
    };
    
    checkFileExists();
  }, [filePath]);

  const handleDownload = async () => {
    if (!filePath) {
      toast({
        title: "Download failed",
        description: "File path is missing",
        variant: "destructive",
      });
      return;
    }

    if (fileExists === false) {
      toast({
        title: "Download failed",
        description: "File does not exist in storage",
        variant: "destructive",
      });
      return;
    }

    setIsDownloading(true);
    
    try {
      console.log(`Starting download for file: ${fileName}, path: ${filePath}`);
      
      if (useSignedUrl) {
        // Use signed URL approach for secure downloads or private buckets
        console.log(`Creating signed URL for ${filePath}`);
        const { data, error } = await supabase
          .storage
          .from('rfq-files')
          .createSignedUrl(filePath, 60); // 60 seconds expiry
        
        if (error) {
          throw error;
        }
        
        console.log(`Signed URL created: ${data.signedUrl}`);
        const signedUrl = data.signedUrl;
        window.open(signedUrl, '_blank');
        
        toast({
          title: "Download started",
          description: `File "${fileName}" is being downloaded`,
        });
      } else {
        // Use direct download approach
        await downloadAndSaveRfqFile(filePath, fileName);
        
        toast({
          title: "Download complete",
          description: `File "${fileName}" has been downloaded`,
        });
      }
    } catch (error: any) {
      console.error("Error downloading file:", error);
      toast({
        title: "Download failed",
        description: error.message || "There was an error downloading the file",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  if (variant === 'icon') {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="px-2 h-8 w-8"
        onClick={handleDownload}
        disabled={isDownloading || fileExists === false}
        title={fileExists === false ? "File not found" : "Download file"}
      >
        {isDownloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size={size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'default'}
      className="flex items-center space-x-2"
      onClick={handleDownload}
      disabled={isDownloading || fileExists === false}
      title={fileExists === false ? "File not found" : undefined}
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileText className="h-4 w-4" />
      )}
      <span>
        {isDownloading 
          ? 'Downloading...' 
          : fileExists === false 
            ? 'File not found'
            : 'Download'
        }
      </span>
    </Button>
  );
};

export default RfqFileDownload;
