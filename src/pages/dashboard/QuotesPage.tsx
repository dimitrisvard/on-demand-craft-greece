import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileText, Folder, ChevronRight, Eye } from 'lucide-react';
import { downloadAndSaveFile } from '@/utils/fileStorage';
import PartFilesView from '@/components/quote-form/PartFilesView';
import { RFQ, RfqItem } from '@/types/customer';
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";

interface QuoteFile {
  id: string;
  rfq_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  part_id?: string;
}

interface ExtendedRFQ extends RFQ {
  files: QuoteFile[];
}

const QuotesPage = () => {
  const [rfqs, setRfqs] = useState<ExtendedRFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRfq, setSelectedRfq] = useState<ExtendedRFQ | null>(null);
  const [expandedRfqId, setExpandedRfqId] = useState<string | null>(null);

  useEffect(() => {
    fetchRFQs();
  }, []);

  const fetchRFQs = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch RFQs with customer data
      const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .select(`
          *,
          customer:customers(*)
        `)
        .order('created_at', { ascending: false });

      if (rfqError) throw rfqError;

      // Then fetch files for each RFQ
      const rfqsWithDetails = await Promise.all(
        (rfqData || []).map(async (rfq) => {
          // Fetch files
          const { data: filesData, error: filesError } = await supabase
            .from('rfq_files')
            .select('*')
            .eq('rfq_id', rfq.id);

          if (filesError) {
            console.error(`Error fetching files for RFQ ${rfq.id}:`, filesError);
          }

          return {
            ...rfq,
            parts_details: (rfq as unknown as { parts_details: RfqItem[] }).parts_details || [],
            files: filesData || []
          } as ExtendedRFQ;
        })
      );

      setRfqs(rfqsWithDetails);
    } catch (err) {
      console.error('Error fetching RFQs:', err);
      setError('Failed to load RFQs');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadFile = async (file: QuoteFile) => {
    try {
      await downloadAndSaveFile(file.file_path, file.file_name);
    } catch (err) {
      console.error('Error downloading file:', err);
    }
  };

  const toggleRfqExpansion = (rfqId: string) => {
    setExpandedRfqId(expandedRfqId === rfqId ? null : rfqId);
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  if (selectedRfq) {
    return (
      <PersistentDashboardLayout>
        <div className="space-y-6">
          <div className="flex items-center mb-6">
            <Button
              variant="ghost"
              onClick={() => setSelectedRfq(null)}
              className="mr-4"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">Quote Details</h1>
          </div>

          <Card className="shadow-sm border hover:shadow-md transition-all duration-200">
            <CardContent className="p-6 space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-2">{selectedRfq.title}</h2>
                <p className="text-muted-foreground">{selectedRfq.description}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-medium mb-2">Customer Information</h3>
                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <p><span className="font-medium">Company:</span> {selectedRfq.customer?.company_name}</p>
                    <p><span className="font-medium">Contact:</span> {selectedRfq.customer?.first_name} {selectedRfq.customer?.last_name}</p>
                    <p><span className="font-medium">Email:</span> {selectedRfq.customer?.email}</p>
                    <p><span className="font-medium">Phone:</span> {selectedRfq.customer?.phone}</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Quote Details</h3>
                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <p><span className="font-medium">Status:</span> {selectedRfq.status}</p>
                    <p><span className="font-medium">Created:</span> {new Date(selectedRfq.created_at).toLocaleDateString()}</p>
                    <p><span className="font-medium">Due Date:</span> {selectedRfq.due_date ? new Date(selectedRfq.due_date).toLocaleDateString() : '-'}</p>
                    <p><span className="font-medium">Total Amount:</span> {selectedRfq.total_amount} {selectedRfq.currency}</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">Parts</h3>
                <div className="bg-muted/30 p-4 rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Unit Price</TableHead>
                        <TableHead>Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedRfq.parts_details?.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.product_name}</TableCell>
                          <TableCell>{item.description}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>{item.unit_price} {selectedRfq.currency}</TableCell>
                          <TableCell>{item.total_price} {selectedRfq.currency}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">Files</h3>
                <div className="bg-muted/30 p-4 rounded-lg border">
                  {selectedRfq.parts_details?.map((item) => {
                    const partFiles = selectedRfq.files.filter(file => file.part_id === item.id);
                    return (
                      <div key={item.id} className="mb-6">
                        <h4 className="font-medium mb-2">{item.product_name}</h4>
                        {partFiles.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {partFiles.map((file) => (
                              <div key={file.id} className="flex items-center justify-between p-3 bg-card rounded border shadow-sm">
                                <div className="flex items-center">
                                  <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                                  <span className="text-sm">{file.file_name}</span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadFile(file)}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">No files attached</p>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* Show general files (not associated with any part) */}
                  {selectedRfq.files.filter(file => !file.part_id).length > 0 && (
                    <div className="mt-6">
                      <h4 className="font-medium mb-2">General Files</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {selectedRfq.files
                          .filter(file => !file.part_id)
                          .map((file) => (
                            <div key={file.id} className="flex items-center justify-between p-3 bg-card rounded border shadow-sm">
                              <div className="flex items-center">
                                <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                                <span className="text-sm">{file.file_name}</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDownloadFile(file)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </PersistentDashboardLayout>
    );
  }

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Quotes</h1>
        <Card className="shadow-sm border hover:shadow-md transition-all duration-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfqs.map((rfq) => (
                <TableRow key={rfq.id}>
                  <TableCell>{rfq.title}</TableCell>
                  <TableCell>{rfq.customer?.company_name}</TableCell>
                  <TableCell>{rfq.status}</TableCell>
                  <TableCell>{rfq.total_amount} {rfq.currency}</TableCell>
                  <TableCell>{new Date(rfq.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{rfq.due_date ? new Date(rfq.due_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedRfq(rfq)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </PersistentDashboardLayout>
  );
};

export default QuotesPage;
