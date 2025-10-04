
import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { FileText, Download, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CustomerRFQsListProps {
  customerId: string;
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

interface RFQ {
  id: string;
  title: string;
  status: string;
  created_at: string;
  total_amount: number;
  currency: string;
  description: string;
}

export const CustomerRFQsList = ({ customerId, isOpen, onClose, embedded = false }: CustomerRFQsListProps) => {
  const [rfqs, setRFQs] = useState<RFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen && customerId) {
      fetchCustomerRFQs();
    }
  }, [isOpen, customerId]);

  const fetchCustomerRFQs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('rfqs')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setRFQs(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to load RFQs for this customer',
        variant: 'destructive',
      });
      console.error('Error fetching RFQs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return <Badge className="bg-blue-100 text-blue-800">New</Badge>;
      case 'in_progress':
        return <Badge className="bg-yellow-100 text-yellow-800">In Progress</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800">Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800">Rejected</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const handleViewRFQ = (rfqId: string) => {
    navigate(`/rfq/${rfqId}`);
    if (!embedded) {
      onClose();
    }
  };

  if (embedded) {
    return (
      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : rfqs.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-lg font-medium">No RFQs found for this customer</p>
            <p className="text-sm text-gray-500">This customer hasn't created any quote requests yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfqs.map((rfq) => (
                <TableRow key={rfq.id}>
                  <TableCell className="font-medium">{rfq.title}</TableCell>
                  <TableCell>
                    {rfq.created_at ? format(new Date(rfq.created_at), 'MMM d, yyyy') : '-'}
                  </TableCell>
                  <TableCell>{getStatusBadge(rfq.status)}</TableCell>
                  <TableCell>
                    {rfq.total_amount ? `${rfq.total_amount} ${rfq.currency}` : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewRFQ(rfq.id)}
                      className="gap-1"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customer RFQ History</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : rfqs.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-lg font-medium">No RFQs found for this customer</p>
            <p className="text-sm text-gray-500">This customer hasn't created any quote requests yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfqs.map((rfq) => (
                <TableRow key={rfq.id}>
                  <TableCell className="font-medium">{rfq.title}</TableCell>
                  <TableCell>
                    {rfq.created_at ? format(new Date(rfq.created_at), 'MMM d, yyyy') : '-'}
                  </TableCell>
                  <TableCell>{getStatusBadge(rfq.status)}</TableCell>
                  <TableCell>
                    {rfq.total_amount ? `${rfq.total_amount} ${rfq.currency}` : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewRFQ(rfq.id)}
                      className="gap-1"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
