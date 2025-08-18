
import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface BucketStatus {
  exists: boolean;
  isPublic: boolean;
  hasRlsPolicies: boolean;
}

const RfqStorageDebug: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [bucketStatus, setBucketStatus] = useState<BucketStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkBucketStatus = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log("Checking storage bucket status...");
      
      // Check if bucket exists
      const { data: buckets, error: listError } = await supabase
        .storage
        .listBuckets();
      
      if (listError) {
        console.error("Error listing buckets:", listError);
        setError(`Error listing buckets: ${listError.message}`);
        return;
      }
      
      const bucket = buckets?.find(b => b.name === 'rfq-files');
      
      if (!bucket) {
        console.log("Bucket 'rfq-files' does not exist");
        setBucketStatus({
          exists: false,
          isPublic: false,
          hasRlsPolicies: false
        });
        return;
      }
      
      console.log("Found bucket:", bucket);
      
      // Create a test file to check permissions
      const testFileName = `test-${Date.now()}.txt`;
      const testFilePath = `test/${testFileName}`;
      const testContent = new Blob(["test file"], { type: "text/plain" });
      
      // Try to upload to test permissions
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from('rfq-files')
        .upload(testFilePath, testContent);
        
      if (uploadError) {
        console.error("Error uploading test file:", uploadError);
        setBucketStatus({
          exists: true,
          isPublic: bucket.public || false,
          hasRlsPolicies: false // Cannot upload, so RLS might be restricting
        });
        return;
      }
      
      console.log("Test upload successful:", uploadData);
      
      // Try to delete the test file
      const { error: deleteError } = await supabase
        .storage
        .from('rfq-files')
        .remove([testFilePath]);
        
      if (deleteError) {
        console.warn("Could not delete test file:", deleteError);
      } else {
        console.log("Test file deleted successfully");
      }
      
      // Everything worked
      setBucketStatus({
        exists: true,
        isPublic: bucket.public || false,
        hasRlsPolicies: true // We could upload, so policies are likely correct
      });
      
    } catch (err: any) {
      console.error("Error checking bucket status:", err);
      setError(`Error checking storage: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Run the check when component mounts
  useEffect(() => {
    checkBucketStatus();
  }, []);

  return (
    <div className="p-4 border rounded-md bg-gray-50">
      <h3 className="text-lg font-medium mb-4">Storage Diagnostic</h3>
      
      {loading ? (
        <div className="flex items-center space-x-2">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          <span>Checking storage configuration...</span>
        </div>
      ) : error ? (
        <div className="text-red-500 flex items-center space-x-2">
          <AlertTriangle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      ) : bucketStatus ? (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            {bucketStatus.exists ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            <span>Storage Bucket: {bucketStatus.exists ? 'Exists' : 'Missing'}</span>
          </div>
          
          {bucketStatus.exists && (
            <>
              <div className="flex items-center space-x-2">
                {bucketStatus.isPublic ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                )}
                <span>Bucket Access: {bucketStatus.isPublic ? 'Public' : 'Private'}</span>
                {!bucketStatus.isPublic && (
                  <span className="text-xs text-gray-500">(Will need signed URLs)</span>
                )}
              </div>
              
              <div className="flex items-center space-x-2">
                {bucketStatus.hasRlsPolicies ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                <span>
                  RLS Policies: {bucketStatus.hasRlsPolicies ? 'Working' : 'Missing or Incorrect'}
                </span>
              </div>
            </>
          )}
          
          {!bucketStatus.exists && (
            <div className="mt-4 text-sm bg-yellow-50 p-3 border border-yellow-200 rounded">
              <p className="font-medium">The 'rfq-files' storage bucket does not exist.</p>
              <p className="mt-1">
                This bucket needs to be created in Supabase for file uploads to work.
              </p>
            </div>
          )}
          
          {bucketStatus.exists && !bucketStatus.hasRlsPolicies && (
            <div className="mt-4 text-sm bg-yellow-50 p-3 border border-yellow-200 rounded">
              <p className="font-medium">Storage permissions appear to be misconfigured.</p>
              <p className="mt-1">
                The RLS policies for the 'rfq-files' bucket need to be updated to allow file uploads.
              </p>
            </div>
          )}
        </div>
      ) : null}
      
      <div className="mt-4">
        <Button
          size="sm"
          onClick={checkBucketStatus}
          disabled={loading}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Run Diagnostics
        </Button>
      </div>
    </div>
  );
};

export default RfqStorageDebug;
