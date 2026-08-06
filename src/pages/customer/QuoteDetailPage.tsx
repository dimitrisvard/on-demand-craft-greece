import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Copy, Trash2, Edit, FileText, Package, Weight, Ruler, Box, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import PartSpecsCard from '@/components/shared/PartSpecsCard';
import { getSignedUrl } from '@/utils/awsS3Storage';
import type { RFQ, RfqItem } from '@/types/customer';

const ThreeDViewerModal = lazy(() => import('@/components/ThreeDViewerModal'));
const PartThumbnail3D = lazy(() => import('@/components/shared/PartThumbnail3D'));

type RfqStatus = RFQ['status'];

const STATUS_CONFIG: Record<RfqStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  draft: { label: 'Draft', variant: 'secondary', className: 'bg-gray-100 text-gray-700 hover:bg-gray-100' },
  sent: { label: 'Quoted', variant: 'default', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
  received: { label: 'Under Review', variant: 'default', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
  approved: { label: 'Approved', variant: 'default', className: 'bg-green-100 text-green-700 hover:bg-green-100' },
  rejected: { label: 'Rejected', variant: 'destructive', className: 'bg-red-100 text-red-700 hover:bg-red-100' },
};

interface RfqFile {
  id: string;
  rfq_id: string;
  part_id?: string | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

interface ParsedSpecs {
  process?: string;
  material?: string;
  surfaceRoughness?: string;
  surfaceTreatment?: string;
  tolerance?: string;
  thickness?: string;
  needsBending?: boolean;
}

function parseSpecsFromDescription(description: string): ParsedSpecs {
  const specs: ParsedSpecs = {};
  if (!description) return specs;

  const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('process:') || lower.startsWith('manufacturing process:')) {
      specs.process = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('material:')) {
      specs.material = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('surface roughness:') || lower.startsWith('roughness:')) {
      specs.surfaceRoughness = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('surface treatment:') || lower.startsWith('treatment:') || lower.startsWith('finishing:')) {
      specs.surfaceTreatment = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('tolerance:') || lower.startsWith('tolerances:')) {
      specs.tolerance = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('thickness:')) {
      specs.thickness = line.split(':').slice(1).join(':').trim().replace(/\s*mm\s*$/i, '');
    } else if (lower.startsWith('bending:')) {
      specs.needsBending = line.split(':').slice(1).join(':').trim().toLowerCase() === 'yes';
    }
  }
  return specs;
}

function parseSpecsFromOriginalValues(original: Record<string, string | boolean>): ParsedSpecs {
  const specs: ParsedSpecs = {};
  for (const [key, value] of Object.entries(original)) {
    const lower = key.toLowerCase();
    if (lower.includes('process')) specs.process = String(value);
    else if (lower.includes('material')) specs.material = String(value);
    else if (lower.includes('roughness')) specs.surfaceRoughness = String(value);
    else if (lower.includes('treatment') || lower.includes('finishing')) specs.surfaceTreatment = String(value);
    else if (lower.includes('tolerance')) specs.tolerance = String(value);
    else if (lower === 'thickness') specs.thickness = String(value);
    else if (lower === 'needsbending') specs.needsBending = value === true || value === 'true';
  }
  return specs;
}

function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
}

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [files, setFiles] = useState<RfqFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ url: string; type: string; name: string } | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const is3DFile = (name: string) => /\.(stl|obj|glb|gltf|step|stp|dxf)$/i.test(name);
  const is3DRenderable = (name: string) => /\.(step|stp|stl|obj|glb|gltf)$/i.test(name);
  const findBest3DFile = (files: any[]) => files.find((f: any) => is3DRenderable(f.file_name)) || files.find((f: any) => is3DFile(f.file_name));

  useEffect(() => {
    if (id) {
      fetchData();
    }
  }, [id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [rfqRes, filesRes] = await Promise.all([
        supabase.from('rfqs').select('*').eq('id', id!).single(),
        supabase.from('rfq_files').select('*').eq('rfq_id', id!),
      ]);

      if (rfqRes.error) throw rfqRes.error;
      setRfq(rfqRes.data as unknown as RFQ);
      setFiles((filesRes.data as unknown as RfqFile[]) || []);

      // Generate signed URLs for 3D files
      const urlMap: Record<string, string> = {};
      const threeDFiles = (filesRes.data || []).filter((f: any) => is3DFile(f.file_name));
      await Promise.all(threeDFiles.map(async (f: any) => {
        const url = await getSignedUrl(f.file_path);
        if (url) urlMap[f.id] = url;
      }));
      setSignedUrls(urlMap);
    } catch (err: any) {
      toast({ title: 'Error loading quote', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  if (!rfq) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">Quote not found</h3>
          <p className="text-muted-foreground mb-6">The quote you are looking for does not exist or has been removed.</p>
          <Button asChild variant="outline">
            <Link to="/customer/projects">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to my projects
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const parts: (RfqItem & { original_values?: Record<string, string> })[] = rfq.parts_details || [];
  const currency = rfq.currency || 'EUR';
  const statusConfig = STATUS_CONFIG[rfq.status];

  const subtotal = parts.reduce((sum, part) => sum + (part.total_price || 0), 0);
  const shippingCost = rfq.shipping_cost;
  const vatAmount = (subtotal + (shippingCost || 0)) * 0.24;
  const total = subtotal + (shippingCost || 0) + vatAmount;
  const totalPieces = parts.reduce((sum, part) => sum + (part.quantity || 0), 0);

  const getFilesForPart = (partId: string) => files.filter((f) => f.part_id === partId);

  const handleDuplicatePart = async (index: number) => {
    if (!rfq) return;
    try {
      const partToDuplicate = { ...parts[index] };
      const updatedParts = [...parts, partToDuplicate];
      const { error } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedParts as any })
        .eq('id', rfq.id);
      if (error) throw error;
      toast({ title: 'Part duplicated', description: `"${partToDuplicate.product_name || `Part ${index + 1}`}" has been duplicated.` });
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Failed to duplicate part', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeletePart = async (index: number) => {
    if (!rfq) return;
    try {
      const partToDelete = parts[index];
      const updatedParts = parts.filter((_, i) => i !== index);
      const { error } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedParts as any })
        .eq('id', rfq.id);
      if (error) throw error;
      toast({ title: 'Part deleted', description: `"${partToDelete.product_name || `Part ${index + 1}`}" has been removed.` });
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Failed to delete part', description: err.message, variant: 'destructive' });
    }
  };

  const handleView3D = (partFiles: RfqFile[]) => {
    const threeDFile = findBest3DFile(partFiles);
    if (threeDFile) {
      const signedUrl = signedUrls[threeDFile.id];
      setViewerFile({ url: signedUrl || threeDFile.file_path, type: threeDFile.file_type, name: threeDFile.file_name });
      setViewerOpen(true);
    } else {
      toast({ title: 'No 3D file', description: 'No viewable 3D file attached to this part.', variant: 'default' });
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/customer/projects"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to my projects
        </Link>

        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Quote {rfq.rfq_number || rfq.title || rfq.id.slice(0, 8)}
          </h1>
          <Badge variant={statusConfig.variant} className={statusConfig.className}>
            {statusConfig.label}
          </Badge>
        </div>

        {rfq.created_at && (
          <p className="text-sm text-muted-foreground mt-1">
            Created {format(new Date(rfq.created_at), 'MMM dd, yyyy')}
            {rfq.updated_at && ` · Updated ${format(new Date(rfq.updated_at), 'MMM dd, yyyy')}`}
          </p>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Parts List */}
        <div className="lg:col-span-2 space-y-4">
          {parts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Package className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-base font-medium mb-1">No parts in this quote</p>
                <p className="text-sm text-muted-foreground">Add parts using the upload area above or start a new quote.</p>
              </CardContent>
            </Card>
          ) : (
            parts.map((part, index) => {
              const specs = part.original_values
                ? parseSpecsFromOriginalValues(part.original_values)
                : parseSpecsFromDescription(part.description || '');
              const partFiles = getFilesForPart(part.id);
              const has3DFile = partFiles.some((f) => is3DFile(f.file_name));

              const threeDFile = findBest3DFile(partFiles);

              return (
                <div key={part.id || index} className="flex gap-3 items-start">
                  {/* 3D Thumbnail */}
                  <div className="hidden sm:block flex-shrink-0">
                    {threeDFile ? (
                      <Suspense
                        fallback={
                          <div className="h-[200px] w-[200px] rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center">
                            <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-300 border-t-slate-600" />
                          </div>
                        }
                      >
                        <PartThumbnail3D fileUrl={signedUrls[threeDFile.id] || threeDFile.file_path} fileName={threeDFile.file_name} />
                      </Suspense>
                    ) : (
                      <div className="h-[200px] w-[200px] rounded-lg bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
                        <Box className="h-8 w-8 text-slate-300" />
                        <span className="text-[10px] text-slate-400 mt-1">No 3D file</span>
                      </div>
                    )}
                  </div>

                  {/* Part card */}
                  <div className="flex-1 min-w-0">
                    <PartSpecsCard
                      index={index}
                      currency={currency}
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
                        thickness: specs.thickness,
                        needsBending: specs.needsBending,
                        fileCount: partFiles.length,
                      }}
                      onView3D={has3DFile ? () => handleView3D(partFiles) : undefined}
                      onEdit={() => navigate(`/customer/quotes/${rfq.id}/parts/${index}`)}
                      onDuplicate={() => handleDuplicatePart(index)}
                      onDelete={() => handleDeletePart(index)}
                      showPricing
                      showActions
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column - Order Summary (sticky) */}
        <div className="lg:col-span-1">
          <div className="sticky top-[140px] max-h-[calc(100vh-160px)] overflow-y-auto">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Parts count */}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Parts</span>
                  <span className="font-medium">{parts.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total pieces</span>
                  <span className="font-medium">{totalPieces}</span>
                </div>

                <Separator />

                {/* Subtotal */}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatCurrency(subtotal, currency)}</span>
                </div>

                {/* Shipping */}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Shipping</span>
                  <span className="font-medium">
                    {shippingCost != null ? formatCurrency(shippingCost, currency) : 'To be calculated'}
                  </span>
                </div>

                <Separator />

                {/* VAT */}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">VAT (24%)</span>
                  <span className="font-medium">{formatCurrency(vatAmount, currency)}</span>
                </div>

                <Separator />

                {/* Total */}
                <div className="flex justify-between items-baseline">
                  <span className="text-sm text-muted-foreground">Total (Inc. VAT)</span>
                  <span className="text-2xl font-bold">{formatCurrency(total, currency)}</span>
                </div>

                {/* Action buttons */}
                {(rfq.status === 'approved' || rfq.status === 'rejected') ? (
                  <p className="text-sm text-center text-muted-foreground py-2">
                    This quote has been {rfq.status === 'approved' ? 'accepted' : 'declined'}.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Button
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      size="lg"
                      disabled={actionLoading}
                      onClick={async () => {
                        try {
                          setActionLoading(true);
                          const { error: statusError } = await supabase
                            .from('rfqs')
                            .update({ status: 'approved' })
                            .eq('id', rfq.id);
                          if (statusError) throw statusError;

                          // Generate PO number server-side: under per-customer
                          // RLS this client can no longer count today's orders
                          // across all customers, so the sequence must come
                          // from a SECURITY DEFINER function.
                          const { data: poData, error: poError } = await (supabase as any).rpc('next_po_number');
                          let poNumber: string = typeof poData === 'string' ? poData : '';
                          if (poError || !poNumber) {
                            const now = new Date();
                            const day = String(now.getDate()).padStart(2, '0');
                            const month = String(now.getMonth() + 1).padStart(2, '0');
                            const dateStr = `${day}${month}${now.getFullYear()}`;
                            poNumber = `PO-${dateStr}-${Date.now() % 1000}`;
                          }

                          const rfqNumber = rfq.rfq_number || '';

                          const { data: orderData, error: orderError } = await supabase
                            .from('orders')
                            .insert({
                              customer_id: rfq.customer_id,
                              rfq_id: rfq.id,
                              status: 'new',
                              total_amount: total,
                              currency: currency,
                              title: poNumber,
                              po_number: poNumber,
                              from_rfq_number: rfqNumber,
                              start_date: new Date().toISOString(),
                              delivery_date: (rfq as any).delivery_date || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                            })
                            .select();
                          if (orderError) throw orderError;

                          // Create order items from parts
                          if (orderData && parts.length > 0) {
                            const orderItems = parts.map((part) => ({
                              order_id: orderData[0].id,
                              product_name: part.product_name || '',
                              description: part.description || '',
                              quantity: part.quantity || 0,
                              unit_price: part.unit_price || 0,
                              total_price: part.total_price || 0,
                            }));
                            await supabase.from('order_items').insert(orderItems);
                          }

                          toast({ title: 'Quote accepted', description: 'Your order has been created successfully.' });
                          navigate('/customer/projects?tab=orders');
                        } catch (err: any) {
                          toast({ title: 'Failed to accept quote', description: err.message, variant: 'destructive' });
                        } finally {
                          setActionLoading(false);
                        }
                      }}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Accept Quote
                    </Button>
                    <Button
                      className="w-full border-red-500 text-red-600 hover:bg-red-50"
                      variant="outline"
                      size="lg"
                      disabled={actionLoading}
                      onClick={async () => {
                        try {
                          setActionLoading(true);
                          const { error } = await supabase
                            .from('rfqs')
                            .update({ status: 'rejected' })
                            .eq('id', rfq.id);
                          if (error) throw error;

                          toast({ title: 'Quote declined', description: 'The quote has been declined.' });
                          navigate('/customer/projects');
                        } catch (err: any) {
                          toast({ title: 'Failed to decline quote', description: err.message, variant: 'destructive' });
                        } finally {
                          setActionLoading(false);
                        }
                      }}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Decline Quote
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
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
