import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Plus, Minus, Upload, Rocket, Box, Save, Loader2 } from 'lucide-react';
import {
  materialOptions,
  surfaceRoughnessOptions,
  toleranceOptions,
  surfaceTreatmentOptions,
} from '@/components/quote-form/constants/materialOptions';
import type { RFQ, RfqItem } from '@/types/customer';
import { useToast } from '@/hooks/use-toast';

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

  // Form state
  const [quantity, setQuantity] = useState(1);
  const [process, setProcess] = useState('');
  const [materialCategory, setMaterialCategory] = useState('');
  const [materialSubtype, setMaterialSubtype] = useState('');
  const [surfaceTreatment, setSurfaceTreatment] = useState('none');
  const [tolerance, setTolerance] = useState('');
  const [surfaceRoughness, setSurfaceRoughness] = useState('');
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
      const { data, error } = await supabase
        .from('rfqs')
        .select('*')
        .eq('id', quoteId!)
        .single();

      if (error) throw error;

      const rfqData = data as unknown as RFQ;
      setRfq(rfqData);

      // Pre-fill form from existing part data
      const parts = rfqData.parts_details || [];
      const part = parts[idx];
      if (part) {
        setQuantity(part.quantity || 1);
      }
    } catch (err: any) {
      toast({ title: 'Error loading quote', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const part: RfqItem | undefined = rfq?.parts_details?.[idx];

  const selectedMaterial = materialOptions.find((m) => m.value === materialCategory);

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
          partMarking.length > 0 && `Part Marking: ${partMarking.join(', ')}`,
          notes && `Notes: ${notes}`,
        ].filter(Boolean).join('\n'),
        original_values: {
          process,
          material: materialCategory,
          materialSubtype,
          surfaceTreatment,
          tolerance,
          surfaceRoughness,
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
                <div className="bg-muted rounded-lg flex items-center justify-center h-48">
                  <Box className="h-12 w-12 text-muted-foreground/40" />
                </div>
                <p className="text-xs text-center text-muted-foreground">XXX &times; YYY &times; ZZZ mm</p>
                <Button variant="outline" className="w-full" size="sm">
                  Open 3D Viewer
                </Button>
              </CardContent>
            </Card>

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
                <p className="text-xs text-muted-foreground">No files attached yet.</p>
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
