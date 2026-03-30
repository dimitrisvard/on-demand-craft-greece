import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getSignedUrl } from '@/utils/awsS3Storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Plus, Minus, Upload, Rocket, Box, Save, Loader2, FileText, Download } from 'lucide-react';
import {
  materialOptions,
  surfaceRoughnessOptions,
  toleranceOptions,
  surfaceTreatmentOptions,
} from '@/components/quote-form/constants/materialOptions';
import type { RFQ, RfqItem } from '@/types/customer';
import { useToast } from '@/hooks/use-toast';

const PartThumbnail3D = lazy(() => import('@/components/shared/PartThumbnail3D'));
const ThreeDViewerModal = lazy(() => import('@/components/ThreeDViewerModal'));

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

const is3DFile = (name: string) => /\.(stl|obj|glb|gltf|step|stp|dxf)$/i.test(name);

const thicknessOptions = [
  { value: '0.5', label: '0.5 mm' },
  { value: '0.8', label: '0.8 mm' },
  { value: '1', label: '1.0 mm' },
  { value: '1.5', label: '1.5 mm' },
  { value: '2', label: '2.0 mm' },
  { value: '2.5', label: '2.5 mm' },
  { value: '3', label: '3.0 mm' },
  { value: '4', label: '4.0 mm' },
  { value: '5', label: '5.0 mm' },
  { value: '6', label: '6.0 mm' },
  { value: '8', label: '8.0 mm' },
  { value: '10', label: '10.0 mm' },
  { value: '12', label: '12.0 mm' },
  { value: '15', label: '15.0 mm' },
  { value: '20', label: '20.0 mm' },
  { value: '25', label: '25.0 mm' },
];

const manufacturingProcessOptions = [
  { value: 'cnc-milling', label: 'CNC Milling' },
  { value: 'turning', label: 'Turning' },
  { value: 'laser-cutting', label: 'Laser Cutting' },
  { value: 'sheet-metal', label: 'Sheet Metal' },
  { value: '3d-printing', label: '3D Printing' },
  { value: 'injection-molding', label: 'Injection Molding' },
];

const partMarkingOptions = [
  { id: 'bag-and-tag', label: 'Bag and Tag' },
  { id: 'engraving', label: 'Engraving' },
  { id: 'laser-mark', label: 'Laser Mark' },
];

export default function PartConfigurationPage() {
  const { quoteId, partIndex } = useParams<{ quoteId: string; partIndex: string }>();
  const { toast } = useToast();
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [loading, setLoading] = useState(true);

  // Files state
  const [partFiles, setPartFiles] = useState<RfqFile[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [viewerOpen, setViewerOpen] = useState(false);

  // Form state
  const [quantity, setQuantity] = useState(1);
  const [process, setProcess] = useState('');
  const [materialCategory, setMaterialCategory] = useState('');
  const [materialSubtype, setMaterialSubtype] = useState('');
  const [surfaceTreatment, setSurfaceTreatment] = useState('none');
  const [tolerance, setTolerance] = useState('');
  const [surfaceRoughness, setSurfaceRoughness] = useState('');
  const [thickness, setThickness] = useState('');
  const [needsBending, setNeedsBending] = useState(false);
  const [partMarking, setPartMarking] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [deliverySpeed, setDeliverySpeed] = useState('standard');
  const [saving, setSaving] = useState(false);

  const idx = parseInt(partIndex || '0', 10);

  useEffect(() => {
    if (quoteId) {
      fetchRfq();
    }
  }, [quoteId]);

  const fetchRfq = async () => {
    try {
      setLoading(true);
      const [rfqRes, filesRes] = await Promise.all([
        supabase.from('rfqs').select('*').eq('id', quoteId!).single(),
        supabase.from('rfq_files').select('*').eq('rfq_id', quoteId!),
      ]);

      if (rfqRes.error) throw rfqRes.error;

      const rfqData = rfqRes.data as unknown as RFQ;
      setRfq(rfqData);

      // Pre-fill form from existing part data
      const parts = rfqData.parts_details || [];
      const part = parts[idx];
      if (part) {
        setQuantity(part.quantity || 1);

        // Pre-fill from original_values if available
        const ov = part.original_values as Record<string, any> | undefined;
        if (ov) {
          if (ov.process) setProcess(ov.process);
          if (ov.material) setMaterialCategory(ov.material);
          if (ov.materialSubtype) setMaterialSubtype(ov.materialSubtype);
          if (ov.surfaceTreatment) setSurfaceTreatment(ov.surfaceTreatment);
          if (ov.tolerance) setTolerance(ov.tolerance);
          if (ov.surfaceRoughness) setSurfaceRoughness(ov.surfaceRoughness);
          if (ov.thickness) setThickness(ov.thickness);
          if (ov.needsBending !== undefined) setNeedsBending(!!ov.needsBending);
          if (ov.partMarking) setPartMarking(ov.partMarking.split(', ').filter(Boolean));
          if (ov.notes) setNotes(ov.notes);
          if (ov.deliverySpeed) setDeliverySpeed(ov.deliverySpeed);
        }
      }

      // Filter files for this part
      const allFiles = (filesRes.data as unknown as RfqFile[]) || [];
      const partId = part?.part_id;
      const filesForPart = partId
        ? allFiles.filter((f) => f.part_id === partId)
        : allFiles;
      setPartFiles(filesForPart);

      // Generate signed URLs for 3D files
      const urlMap: Record<string, string> = {};
      const threeDFiles = filesForPart.filter((f) => is3DFile(f.file_name));
      await Promise.all(
        threeDFiles.map(async (f) => {
          const url = await getSignedUrl(f.file_path);
          if (url) urlMap[f.id] = url;
        })
      );
      setSignedUrls(urlMap);
    } catch (err: any) {
      toast({ title: 'Error loading quote', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const part: RfqItem | undefined = rfq?.parts_details?.[idx];

  const selectedMaterial = materialOptions.find((m) => m.value === materialCategory);

  // Find the primary 3D file for this part
  const threeDFile = partFiles.find((f) => is3DFile(f.file_name));
  const threeDFileUrl = threeDFile ? signedUrls[threeDFile.id] : null;

  const handlePartMarkingToggle = (markingId: string) => {
    setPartMarking((prev) =>
      prev.includes(markingId) ? prev.filter((id) => id !== markingId) : [...prev, markingId]
    );
  };

  const handleSave = async () => {
    if (!rfq) return;
    try {
      setSaving(true);
      const updatedParts = [...(rfq.parts_details || [])];
      updatedParts[idx] = {
        ...updatedParts[idx],
        quantity,
        description: [
          process && `Manufacturing Process: ${process}`,
          materialCategory && `Material: ${materialCategory}${materialSubtype ? ` / ${materialSubtype}` : ''}`,
          surfaceTreatment && surfaceTreatment !== 'none' && `Surface Treatment: ${surfaceTreatment}`,
          tolerance && `Tolerance: ${tolerance}`,
          surfaceRoughness && `Surface Roughness: ${surfaceRoughness}`,
          thickness && `Thickness: ${thickness} mm`,
          needsBending && `Requires Bending: Yes`,
          partMarking.length > 0 && `Part Marking: ${partMarking.join(', ')}`,
          notes && `Notes: ${notes}`,
        ].filter(Boolean).join('\n'),
        original_values: {
          process,
          processLabel: manufacturingProcessOptions.find(p => p.value === process)?.label || process,
          material: materialCategory,
          materialLabel: materialOptions.find(m => m.value === materialCategory)?.label || materialCategory,
          materialSubtype,
          materialSubtypeLabel: selectedMaterial?.subtypes.find(s => s.value === materialSubtype)?.label || materialSubtype,
          surfaceTreatment,
          surfaceTreatmentLabel: surfaceTreatmentOptions.find(o => o.value === surfaceTreatment)?.label || surfaceTreatment,
          tolerance,
          toleranceLabel: toleranceOptions.find(o => o.value === tolerance)?.label || tolerance,
          surfaceRoughness,
          surfaceRoughnessLabel: surfaceRoughnessOptions.find(o => o.value === surfaceRoughness)?.label || surfaceRoughness,
          thickness,
          needsBending,
          partMarking: partMarking.join(', '),
          notes,
          deliverySpeed,
        },
      };

      const { error } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedParts as any })
        .eq('id', rfq.id);

      if (error) throw error;
      toast({ title: 'Part saved', description: 'Your changes have been saved successfully.' });
    } catch (err: any) {
      toast({ title: 'Failed to save', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
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

  if (!rfq || !part) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Box className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">Part not found</h3>
          <p className="text-muted-foreground mb-6">
            The part you are looking for does not exist or has been removed.
          </p>
          <Button asChild variant="outline">
            <Link to={quoteId ? `/customer/quotes/${quoteId}` : '/customer/projects'}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Quote
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          to={`/customer/quotes/${quoteId}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Quote
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          {part.product_name || `Part ${idx + 1}`}
        </h1>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Configuration Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quantity Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quantity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 text-center"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setQuantity((q) => q + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Technology Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Technology</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="process">Manufacturing Process</Label>
                <Select value={process} onValueChange={setProcess}>
                  <SelectTrigger id="process">
                    <SelectValue placeholder="Select a process" />
                  </SelectTrigger>
                  <SelectContent>
                    {manufacturingProcessOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Material Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Material</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="material-category">Material Category</Label>
                <Select
                  value={materialCategory}
                  onValueChange={(val) => {
                    setMaterialCategory(val);
                    setMaterialSubtype('');
                  }}
                >
                  <SelectTrigger id="material-category">
                    <SelectValue placeholder="Select material category" />
                  </SelectTrigger>
                  <SelectContent>
                    {materialOptions.map((mat) => (
                      <SelectItem key={mat.value} value={mat.value}>
                        {mat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedMaterial && selectedMaterial.subtypes.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="material-subtype">Grade / Alloy</Label>
                  <Select value={materialSubtype} onValueChange={setMaterialSubtype}>
                    <SelectTrigger id="material-subtype">
                      <SelectValue placeholder="Select grade" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedMaterial.subtypes.map((sub) => (
                        <SelectItem key={sub.value} value={sub.value}>
                          {sub.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

            </CardContent>
          </Card>

          {/* Thickness & Bending Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Thickness &amp; Bending</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="thickness">Material Thickness</Label>
                <Select value={thickness} onValueChange={setThickness}>
                  <SelectTrigger id="thickness">
                    <SelectValue placeholder="Select thickness" />
                  </SelectTrigger>
                  <SelectContent>
                    {thicknessOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="needsBending"
                  checked={needsBending}
                  onCheckedChange={(checked) => setNeedsBending(!!checked)}
                />
                <Label htmlFor="needsBending" className="text-sm font-normal cursor-pointer">
                  This part requires bending
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Finish Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Finish</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="surface-treatment">Surface Treatment</Label>
                <Select value={surfaceTreatment} onValueChange={setSurfaceTreatment}>
                  <SelectTrigger id="surface-treatment">
                    <SelectValue placeholder="Select surface treatment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {surfaceTreatmentOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Tolerance Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tolerance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="tolerance">Tolerance Standard</Label>
                <Select value={tolerance} onValueChange={setTolerance}>
                  <SelectTrigger id="tolerance">
                    <SelectValue placeholder="Select tolerance" />
                  </SelectTrigger>
                  <SelectContent>
                    {toleranceOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Surface Roughness Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Surface Roughness</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="roughness">Surface Roughness</Label>
                <Select value={surfaceRoughness} onValueChange={setSurfaceRoughness}>
                  <SelectTrigger id="roughness">
                    <SelectValue placeholder="Select surface roughness" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard (3.2 µm Ra)</SelectItem>
                    <SelectItem value="fine">Fine (1.6 µm Ra)</SelectItem>
                    <SelectItem value="very-fine">Very Fine (0.8 µm Ra)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Part Marking Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Part Marking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {partMarkingOptions.map((opt) => (
                <div key={opt.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={opt.id}
                    checked={partMarking.includes(opt.id)}
                    onCheckedChange={() => handlePartMarkingToggle(opt.id)}
                  />
                  <Label htmlFor={opt.id} className="text-sm font-normal cursor-pointer">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </CardContent>
          </Card>


          {/* Additional Requirements Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Additional Requirements</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="notes">Production Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter any additional requirements or production notes..."
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-1 space-y-6">
          {/* Pricing Panel */}
          <div className="sticky top-6 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pricing &amp; Delivery</CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup value={deliverySpeed} onValueChange={setDeliverySpeed} className="space-y-3">
                  <label
                    htmlFor="speed-standard"
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      deliverySpeed === 'standard'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="standard" id="speed-standard" />
                      <div>
                        <p className="text-sm font-medium">Standard</p>
                        <p className="text-xs text-muted-foreground">10-15 business days</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-muted-foreground">---.-- &euro;</span>
                  </label>
                  <label
                    htmlFor="speed-express"
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      deliverySpeed === 'express'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="express" id="speed-express" />
                      <div className="flex items-center gap-1.5">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1">
                            Express
                            <Rocket className="h-3.5 w-3.5 text-orange-500" />
                          </p>
                          <p className="text-xs text-muted-foreground">5-7 business days</p>
                        </div>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-muted-foreground">---.-- &euro;</span>
                  </label>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* 3D Preview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">3D Preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {threeDFile && threeDFileUrl ? (
                  <div className="flex justify-center">
                    <Suspense
                      fallback={
                        <div className="bg-muted rounded-lg flex items-center justify-center h-48 w-full">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                      }
                    >
                      <PartThumbnail3D
                        fileUrl={threeDFileUrl}
                        fileName={threeDFile.file_name}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <>
                    <div className="bg-muted rounded-lg flex items-center justify-center h-48">
                      <Box className="h-12 w-12 text-muted-foreground/40" />
                    </div>
                    <p className="text-xs text-center text-muted-foreground">No 3D file available</p>
                  </>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={!threeDFile || !threeDFileUrl}
                  onClick={() => setViewerOpen(true)}
                >
                  Open 3D Viewer
                </Button>
              </CardContent>
            </Card>

            {/* 3D Viewer Modal */}
            {viewerOpen && threeDFile && threeDFileUrl && (
              <Suspense fallback={null}>
                <ThreeDViewerModal
                  open={viewerOpen}
                  onClose={() => setViewerOpen(false)}
                  fileUrl={threeDFileUrl}
                  fileType={threeDFile.file_type}
                  fileName={threeDFile.file_name}
                />
              </Suspense>
            )}

            {/* File Management */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Part Files</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center">
                  <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Drag &amp; drop files</p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                </div>
                {partFiles.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {partFiles.length} file{partFiles.length !== 1 ? 's' : ''} attached
                    </p>
                    {partFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-2 rounded-md border text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{file.file_name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                          {(file.file_size / 1024).toFixed(0)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No files attached yet.</p>
                )}
              </CardContent>
            </Card>

            {/* Save & Navigation */}
            <Button
              className="w-full"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to={`/customer/quotes/${quoteId}`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Quote
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
