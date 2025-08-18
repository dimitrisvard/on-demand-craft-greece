import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { downloadAndSaveFile, ensureStorageBucketExists } from '@/utils/fileStorage';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Download, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FileRecord {
  id: string;
  file_name: string;
  file_path: string;
  part_id?: string;
  quote_request_id: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

const RFQPage = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // Ensure storage bucket exists and is correctly configured
    ensureStorageBucketExists();
    
    // If no ID is provided, navigate to RFQ Management
    if (!id) {
      console.log("No RFQ ID provided, redirecting to RFQ Management");
      navigate('/rfq-management', { replace: true });
      return;
    }

    const fetchQuoteFiles = async () => {
      try {
        setLoading(true);
        setError(null);
        
        console.log("RFQPage: Fetching quote with ID:", id);
        
        // Check if the quote exists first
        const { data: quoteData, error: quoteError } = await supabase
          .from('rfqs')
          .select('*')
          .eq('id', id)
          .maybeSingle(); // Use maybeSingle instead of single to avoid errors
          
        if (quoteError) {
          console.error("RFQPage: Error fetching quote:", quoteError);
          throw quoteError;
        }
        
        if (!quoteData) {
          console.error("RFQPage: Quote not found with ID:", id);
          setError(t('rfq_not_found'));
          setLoading(false);
          return;
        }
        
        console.log("RFQPage: Quote data found:", quoteData);
        
        // If quote exists, fetch its files
        const { data, error } = await supabase
          .from('quote_files')
          .select('*')
          .eq('quote_request_id', id);
          
        if (error) {
          console.error("RFQPage: Error fetching files:", error);
          throw error;
        }
        
        console.log("RFQPage: Files found:", data);
        setFiles(data as FileRecord[] || []);
      } catch (error: any) {
        console.error('Exception while fetching quote files:', error);
        setError(error.message || t('rfq_failed_load_files'));
        toast({
          title: t('error'),
          description: t('rfq_problem_loading_data'),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchQuoteFiles();
  }, [id, toast, navigate, t]);

  const handleDownloadFile = async (filePath: string, fileName?: string) => {
    try {
      console.log('Starting download for file:', filePath, 'with name:', fileName);
      
      if (!filePath) {
        toast({
          title: t('download_error'),
          description: t('file_path_missing'),
          variant: "destructive",
        });
        return;
      }
      
      await downloadAndSaveFile(filePath, fileName);
      
      toast({
        title: t('download_started'),
        description: t('downloading_file', { fileName: fileName || t('file') }),
      });
    } catch (error: any) {
      console.error('Download error:', error);
      toast({
        title: t('download_error'),
        description: error.message || t('rfq_failed_download_file'),
        variant: "destructive",
      });
    }
  };

  const handleGoBack = () => {
    // Check if we came from rfq-management to avoid loops
    if (window.history.length > 1) {
      navigate(-1); // Go back to previous page
    } else {
      navigate('/rfq-management', { replace: false });
    }
  };

  return (
    <div className="container mx-auto p-6 pt-20">
      <div className="mb-6">
        <Button 
          variant="outline" 
          className="flex items-center gap-2"
          onClick={handleGoBack}
        >
          <ChevronLeft className="h-4 w-4" />
          {t('rfq_back_to_management')}
        </Button>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border-l-4 border-red-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">
                {error}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">{t('rfq_files_title')}</h2>
          {files.length === 0 ? (
            <p className="text-gray-500">{t('no_files_associated')}</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {files.map((file) => (
                <li key={file.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center">
                    <FileText className="h-5 w-5 mr-2 text-gray-500" />
                    <span className="text-sm">{file.file_name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownloadFile(file.file_path, file.file_name)}
                  >
                    <Download className="h-4 w-4" /> {t('download')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      
      {/* Debug information to show file count */}
      {!loading && !error && (
        <div className="mt-4 bg-gray-50 p-4 rounded-md border border-gray-200">
          <h3 className="text-sm font-medium text-gray-600">{t('debug_info')}</h3>
          <p className="text-sm text-gray-500">{t('files_found', { count: files.length })}</p>
        </div>
      )}
      
      <Toaster />
    </div>
  );
};

export default RFQPage;
