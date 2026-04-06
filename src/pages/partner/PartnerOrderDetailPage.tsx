import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowLeft, Download, FileText, Package, ChevronDown, Printer } from 'lucide-react';
import { format } from 'date-fns';
import PartSpecsCard from '@/components/shared/PartSpecsCard';
import type { Order, RFQ, RfqItem } from '@/types/customer';

const ThreeDViewerModal = lazy(() => import('@/components/ThreeDViewerModal'));

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

interface ParsedSpecs {
  process?: string;
  material?: string;
  surfaceRoughness?: string;
  surfaceTreatment?: string;
  tolerance?: string;
}

function parseSpecsFromDescription(description: string): ParsedSpecs {
  const specs: ParsedSpecs = {};
  if (!description) return specs;
  const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('process:') || lower.startsWith('manufacturing process:')) specs.process = line.split(':').slice(1).join(':').trim();
    else if (lower.startsWith('material:')) specs.material = line.split(':').slice(1).join(':').trim();
    else if (lower.startsWith('surface roughness:') || lower.startsWith('roughness:')) specs.surfaceRoughness = line.split(':').slice(1).join(':').trim();
    else if (lower.startsWith('surface treatment:') || lower.startsWith('treatment:') || lower.startsWith('finishing:')) specs.surfaceTreatment = line.split(':').slice(1).join(':').trim();
    else if (lower.startsWith('tolerance:')) specs.tolerance = line.split(':').slice(1).join(':').trim();
  }
  return specs;
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

const is3DFile = (name: string) => /\.(stl|obj|glb|gltf|step|stp|dxf)$/i.test(name);
const is3DRenderable = (name: string) => /\.(step|stp|stl|obj|glb|gltf)$/i.test(name);
const findBest3DFile = (files: any[]) => files.find(f => is3DRenderable(f.file_name)) || files.find(f => is3DFile(f.file_name));

export default function PartnerOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [files, setFiles] = useState<RfqFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownReference, setOwnReference] = useState('');
  const [productionOpen, setProductionOpen] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ url: string; type: string; name: string } | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
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

        if (orderData?.rfq_id) {
          const [rfqRes, filesRes] = await Promise.all([
            supabase.from('rfqs').select('*').eq('id', orderData.rfq_id).single(),
            supabase.from('rfq_files').select('*').eq('rfq_id', orderData.rfq_id),
          ]);

          if (!rfqRes.error && rfqRes.data) setRfq(rfqRes.data as RFQ);
          if (!filesRes.error && filesRes.data) setFiles(filesRes.data as RfqFile[]);
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
      <div className="p-4 sm:p-6">
        <Link to="/partner/orders" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to My Orders
        </Link>
        <p className="text-muted-foreground">Order not found.</p>
      </div>
    );
  }

  const poNumber = `PO-${order.id.slice(0, 8).toUpperCase()}`;
  const parts: (RfqItem & { original_values?: Record<string, string> })[] = rfq?.parts_details ?? [];
  const totalPieces = parts.reduce((sum, p) => sum + (p.quantity || 0), 0);

  const getFilesForPart = (partId: string) => files.filter((f) => f.part_id === partId);

  const handleView3D = (partFiles: RfqFile[]) => {
    const threeDFile = findBest3DFile(partFiles);
    if (threeDFile) {
      setViewerFile({ url: threeDFile.file_path, type: threeDFile.file_type, name: threeDFile.file_name });
      setViewerOpen(true);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/partner/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to My Orders
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
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

        {/* Internal reference */}
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

      {/* Order Info Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Total Price</p>
            <p className="text-lg font-semibold">
              {new Intl.NumberFormat('de-DE', { style: 'currency', currency: order.currency || 'EUR' }).format(order.total_amount || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Quantity</p>
            <p className="text-lg font-semibold">{totalPieces} parts</p>
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
            <p className="text-xs text-muted-foreground mb-1">Production</p>
            <Badge
              className={`text-xs ${productionStatusColorMap[order.production_status ?? ''] ?? 'bg-gray-100 text-gray-800'}`}
            >
              {formatStatusLabel(order.production_status ?? 'pending')}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Production Documents */}
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
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Production Order (PDF)
              </Button>
              <Button variant="outline" size="sm" className="gap-2">
                <FileText className="h-4 w-4" />
                PO Tech Details (PDF)
              </Button>
              <Button variant="outline" size="sm" className="gap-2">
                <Package className="h-4 w-4" />
                Labels for Marking Parts
              </Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Parts Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Parts ({parts.length} parts, {totalPieces} pcs)
          </h2>
          <Button variant="outline" size="sm" className="gap-2">
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
          const specs = part.original_values
            ? (() => {
                const s: ParsedSpecs = {};
                for (const [key, value] of Object.entries(part.original_values!)) {
                  const lower = key.toLowerCase();
                  if (lower.includes('process')) s.process = value;
                  else if (lower.includes('material')) s.material = value;
                  else if (lower.includes('roughness')) s.surfaceRoughness = value;
                  else if (lower.includes('treatment') || lower.includes('finishing')) s.surfaceTreatment = value;
                  else if (lower.includes('tolerance')) s.tolerance = value;
                }
                return s;
              })()
            : parseSpecsFromDescription(part.description || '');

          const partFiles = getFilesForPart(part.id);
          const has3DFile = partFiles.some((f) => is3DFile(f.file_name));

          return (
            <PartSpecsCard
              key={part.id || index}
              index={index}
              currency={order.currency || 'EUR'}
              part={{
                product_name: part.product_name,
                description: part.description,
                quantity: part.quantity,
                unit_price: part.unit_price,
                total_price: part.total_price,
                material: specs.material,
                process: specs.process,
                tolerance: specs.tolerance,
                surfaceRoughness: specs.surfaceRoughness,
                surfaceTreatment: specs.surfaceTreatment,
                fileCount: partFiles.length,
              }}
              onView3D={has3DFile ? () => handleView3D(partFiles) : undefined}
              showPricing
              showActions={!!has3DFile}
            />
          );
        })}
      </div>

      {/* 3D Viewer Modal */}
      <Suspense fallback={null}>
        <ThreeDViewerModal
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          fileUrl={viewerFile?.url || null}
          fileType={viewerFile?.type || null}
          fileName={viewerFile?.name || null}
        />
      </Suspense>
    </div>
  );
}
