import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowLeft, Download, FileText, Package, ChevronDown, Box, Printer } from 'lucide-react';
import { format } from 'date-fns';
import type { Order, RFQ, RfqItem } from '@/types/customer';

interface RfqFile {
  id: string;
  rfq_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  created_at?: string;
  part_id?: string | null;
}

const statusColorMap: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const productionStatusColorMap: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  in_production: 'bg-orange-100 text-orange-800',
  ready: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-green-100 text-green-800',
};

const formatStatusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function PartnerOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [files, setFiles] = useState<RfqFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownReference, setOwnReference] = useState('');
  const [productionOpen, setProductionOpen] = useState(true);

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch order
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .select('*')
          .eq('id', id)
          .single();

        if (orderError) {
          console.error('Error fetching order:', orderError);
          setLoading(false);
          return;
        }

        setOrder(orderData as Order);

        // Fetch associated RFQ if exists
        if (orderData?.rfq_id) {
          const { data: rfqData, error: rfqError } = await supabase
            .from('rfqs')
            .select('*')
            .eq('id', orderData.rfq_id)
            .single();

          if (!rfqError && rfqData) {
            setRfq(rfqData as RFQ);
          }

          // Fetch files
          const { data: filesData, error: filesError } = await supabase
            .from('rfq_files')
            .select('*')
            .eq('rfq_id', orderData.rfq_id);

          if (!filesError && filesData) {
            setFiles(filesData as RfqFile[]);
          }
        }
      } catch (err) {
        console.error('Unexpected error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6">
        <Link to="/orders" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to My Orders
        </Link>
        <p className="text-muted-foreground">Order not found.</p>
      </div>
    );
  }

  const poNumber = `PO-${order.id.slice(0, 8).toUpperCase()}`;
  const parts: RfqItem[] = rfq?.parts_details ?? [];
  const totalQuantity = parts.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const totalPieces = parts.reduce((sum, p) => sum + (p.quantity || 0), 0);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to My Orders
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {order.title || poNumber}
            </h1>
            <p className="text-sm text-muted-foreground">{poNumber}</p>
          </div>

          <Badge
            className={`text-xs px-3 py-1 ${statusColorMap[order.status] ?? 'bg-gray-100 text-gray-800'}`}
          >
            {formatStatusLabel(order.status)}
          </Badge>
        </div>

        {/* Your own number field */}
        <div className="mt-4 max-w-sm">
          <label className="text-sm font-medium text-muted-foreground mb-1 block">
            Your own number (internal reference)
          </label>
          <Input
            placeholder="Enter your internal reference..."
            value={ownReference}
            onChange={(e) => setOwnReference(e.target.value)}
          />
        </div>
      </div>

      <Separator />

      {/* Order Info Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Total Price</p>
            <p className="text-lg font-semibold">
              {order.currency === 'EUR' ? '€' : order.currency}
              {order.total_amount?.toFixed(2) ?? '0.00'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Quantity</p>
            <p className="text-lg font-semibold">{totalQuantity} parts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Delivery Date</p>
            <p className="text-lg font-semibold">
              {order.delivery_date
                ? format(new Date(order.delivery_date), 'dd MMM yyyy')
                : 'TBD'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Production Status</p>
            <Badge
              className={`text-xs ${productionStatusColorMap[order.production_status ?? ''] ?? 'bg-gray-100 text-gray-800'}`}
            >
              {formatStatusLabel(order.production_status ?? 'pending')}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Collapsible Production Documents */}
      <Collapsible open={productionOpen} onOpenChange={setProductionOpen}>
        <Card>
          <CardHeader className="pb-2">
            <CollapsibleTrigger className="flex items-center justify-between w-full">
              <CardTitle className="text-base flex items-center gap-2">
                <Printer className="h-4 w-4" />
                Production Documents
              </CardTitle>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${productionOpen ? 'rotate-180' : ''}`}
              />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-2 flex flex-wrap gap-3">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => {}}>
                <Download className="h-4 w-4" />
                Production Order (PDF)
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => {}}>
                <FileText className="h-4 w-4" />
                PO Tech Details (PDF)
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => {}}>
                <Package className="h-4 w-4" />
                Labels for Marking Parts
              </Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Parts Detail Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Parts ({parts.length} parts, {totalPieces} pcs)
          </h2>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => {}}>
            <Download className="h-4 w-4" />
            Download ZIP - All Part Files
          </Button>
        </div>

        {parts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No parts details available for this order.
          </p>
        )}

        {parts.map((part, index) => {
          // Try to parse description for extra specs
          let tolerance = '-';
          let surfaceRoughness = '-';
          let treatment = '-';
          let remarks = part.description || '';

          // Attempt simple extraction from description if formatted
          const toleranceMatch = remarks.match(/tolerance[:\s]*([^\n,;]+)/i);
          if (toleranceMatch) tolerance = toleranceMatch[1].trim();

          const roughnessMatch = remarks.match(/(?:surface\s*roughness|roughness)[:\s]*([^\n,;]+)/i);
          if (roughnessMatch) surfaceRoughness = roughnessMatch[1].trim();

          const treatmentMatch = remarks.match(/(?:treatment|finish|coating)[:\s]*([^\n,;]+)/i);
          if (treatmentMatch) treatment = treatmentMatch[1].trim();

          return (
            <Card key={part.id || index}>
              <CardContent className="pt-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="font-semibold text-base">{part.product_name}</h3>
                    {/* Process badge - extracted from description if available */}
                    <Badge variant="secondary" className="text-xs">
                      Manufacturing
                    </Badge>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {part.quantity} pcs &times; €{part.unit_price?.toFixed(2) ?? '0.00'}
                    </p>
                    <p className="font-semibold">
                      Total: €{part.total_price?.toFixed(2) ?? '0.00'}
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Material</p>
                    <p className="font-medium">{part.product_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Tolerance</p>
                    <p className="font-medium">{tolerance}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Surface Roughness</p>
                    <p className="font-medium">{surfaceRoughness}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Treatment</p>
                    <p className="font-medium">{treatment}</p>
                  </div>
                </div>

                {remarks && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Production Remarks</p>
                    <p className="text-sm bg-muted/50 rounded-md p-3">{remarks}</p>
                  </div>
                )}

                <Button variant="outline" size="sm" className="gap-2" onClick={() => {}}>
                  <Box className="h-4 w-4" />
                  View 3D Model
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
