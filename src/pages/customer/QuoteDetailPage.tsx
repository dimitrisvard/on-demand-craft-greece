import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Upload, Copy, Trash2, Edit, FileText, Package } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { RFQ, RfqItem } from '@/types/customer';

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
    }
  }
  return specs;
}

function parseSpecsFromOriginalValues(original: Record<string, string>): ParsedSpecs {
  const specs: ParsedSpecs = {};
  for (const [key, value] of Object.entries(original)) {
    const lower = key.toLowerCase();
    if (lower.includes('process')) specs.process = value;
    else if (lower.includes('material')) specs.material = value;
    else if (lower.includes('roughness')) specs.surfaceRoughness = value;
    else if (lower.includes('treatment') || lower.includes('finishing')) specs.surfaceTreatment = value;
    else if (lower.includes('tolerance')) specs.tolerance = value;
  }
  return specs;
}

function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
}

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [files, setFiles] = useState<RfqFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [discountCode, setDiscountCode] = useState('');

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
  const total = subtotal + (shippingCost || 0);
  const totalPieces = parts.reduce((sum, part) => sum + (part.quantity || 0), 0);

  const getFilesForPart = (partId: string) => files.filter((f) => f.part_id === partId);

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
          <h1 className="text-3xl font-bold tracking-tight">
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

      {/* File Upload Placeholder */}
      <Card className="mb-6 border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <Upload className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-base font-medium mb-1">Add new parts to quote</p>
          <p className="text-sm text-muted-foreground">
            Drag &amp; Drop your designs or{' '}
            <Link to="/quote" className="text-primary underline hover:text-primary/80">
              Browse
            </Link>
          </p>
        </CardContent>
      </Card>

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
              const hasSpecs = specs.process || specs.material || specs.surfaceRoughness || specs.surfaceTreatment || specs.tolerance;

              return (
                <Card key={part.id || index} className="transition-shadow hover:shadow-md">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold truncate">
                          {part.product_name || `Part ${index + 1}`}
                        </h3>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-lg font-semibold">
                          {formatCurrency(part.total_price || 0, currency)}
                        </p>
                        {part.quantity > 1 && (
                          <p className="text-xs text-muted-foreground">
                            {formatCurrency(part.unit_price || 0, currency)} x {part.quantity}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Specs Grid */}
                    {hasSpecs && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mb-3 text-sm">
                        {specs.process && (
                          <div>
                            <span className="text-muted-foreground">Process:</span>{' '}
                            <span className="font-medium">{specs.process}</span>
                          </div>
                        )}
                        {specs.material && (
                          <div>
                            <span className="text-muted-foreground">Material:</span>{' '}
                            <span className="font-medium">{specs.material}</span>
                          </div>
                        )}
                        {specs.surfaceRoughness && (
                          <div>
                            <span className="text-muted-foreground">Surface Roughness:</span>{' '}
                            <span className="font-medium">{specs.surfaceRoughness}</span>
                          </div>
                        )}
                        {specs.surfaceTreatment && (
                          <div>
                            <span className="text-muted-foreground">Surface Treatment:</span>{' '}
                            <span className="font-medium">{specs.surfaceTreatment}</span>
                          </div>
                        )}
                        {specs.tolerance && (
                          <div>
                            <span className="text-muted-foreground">Tolerance:</span>{' '}
                            <span className="font-medium">{specs.tolerance}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Description fallback if no structured specs */}
                    {!hasSpecs && part.description && (
                      <p className="text-sm text-muted-foreground mb-3 whitespace-pre-line line-clamp-3">
                        {part.description}
                      </p>
                    )}

                    {/* Quantity badge */}
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline" className="text-xs">
                        Qty: {part.quantity}
                      </Badge>
                    </div>

                    {/* File badges */}
                    {partFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {partFiles.map((file) => (
                          <Badge key={file.id} variant="secondary" className="text-xs gap-1">
                            <FileText className="h-3 w-3" />
                            {file.file_name}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <Separator className="my-3" />

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/quote">
                          <Edit className="mr-1 h-3.5 w-3.5" />
                          Edit Specifications
                        </Link>
                      </Button>
                      <Button variant="ghost" size="sm" title="Duplicate part">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" title="Delete part">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Right Column - Order Summary (sticky) */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
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

                {/* Discount code */}
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Discount code</label>
                  <div className="flex gap-2">
                    <Input
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value)}
                      placeholder="Enter code"
                      className="text-sm"
                    />
                    <Button variant="outline" size="sm" className="flex-shrink-0">
                      Apply
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Total */}
                <div className="flex justify-between items-baseline">
                  <span className="text-sm text-muted-foreground">Total (excl. VAT)</span>
                  <span className="text-2xl font-bold">{formatCurrency(total, currency)}</span>
                </div>

                {/* CTA */}
                <Button
                  className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
                  size="lg"
                  disabled={rfq.status === 'approved'}
                >
                  Proceed to Checkout
                </Button>

                {rfq.status === 'approved' && (
                  <p className="text-xs text-center text-muted-foreground">
                    This quote has already been approved.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
