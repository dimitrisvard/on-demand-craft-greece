import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import InventoryLayout from '@/components/inventory/InventoryLayout';
import { getMaterials, createMaterial, receiveStock } from '@/utils/inventoryApi';
import type { Material, MaterialCategory, BaseUnit } from '@/types/inventory';

const CATEGORIES: { value: MaterialCategory; label: string }[] = [
  { value: 'sheet_metal', label: 'Sheet Metal' },
  { value: 'billet', label: 'Billet' },
  { value: 'rod', label: 'Rod' },
  { value: 'tube', label: 'Tube' },
  { value: 'filament', label: 'Filament' },
  { value: 'resin', label: 'Resin' },
  { value: 'powder', label: 'Powder' },
  { value: 'other', label: 'Other' },
];

const UNITS: { value: BaseUnit; label: string }[] = [
  { value: 'm2', label: 'm² (area)' },
  { value: 'kg', label: 'kg (weight)' },
  { value: 'L', label: 'L (volume)' },
  { value: 'm', label: 'm (length)' },
  { value: 'pcs', label: 'pcs (pieces)' },
];

export default function StockReceive() {
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [showNewMaterial, setShowNewMaterial] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // New material form
  const [newMaterial, setNewMaterial] = useState({
    name: '', category: 'sheet_metal' as MaterialCategory, grade: '',
    thickness_mm: '', base_unit: 'm2' as BaseUnit,
    cost_per_unit: '', supplier: '', low_stock_threshold: '',
  });

  // Receive form
  const [receiveForm, setReceiveForm] = useState({
    quantity: '1', widthMm: '2000', heightMm: '1000',
    batchNumber: '', location: '', costPerUnit: '', notes: '',
  });

  useEffect(() => {
    getMaterials().then(setMaterials).catch(console.error);
  }, []);

  const selectedMaterial = materials.find(m => m.id === selectedMaterialId);
  const isSheet = selectedMaterial?.category === 'sheet_metal' || newMaterial.category === 'sheet_metal';

  async function handleCreateMaterial() {
    try {
      const mat = await createMaterial({
        name: newMaterial.name,
        category: newMaterial.category,
        grade: newMaterial.grade || null,
        thickness_mm: newMaterial.thickness_mm ? parseFloat(newMaterial.thickness_mm) : null,
        base_unit: newMaterial.base_unit,
        cost_per_unit: newMaterial.cost_per_unit ? parseFloat(newMaterial.cost_per_unit) : null,
        supplier: newMaterial.supplier || null,
        low_stock_threshold: newMaterial.low_stock_threshold ? parseFloat(newMaterial.low_stock_threshold) : null,
      });
      setMaterials(prev => [...prev, mat]);
      setSelectedMaterialId(mat.id);
      setShowNewMaterial(false);
      toast({ title: 'Material created', description: `${mat.name} added to catalog` });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  }

  async function handleReceive() {
    const matId = selectedMaterialId;
    if (!matId) {
      toast({ title: 'Select a material', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const qty = parseInt(receiveForm.quantity) || 1;
      const items = await receiveStock({
        materialId: matId,
        quantity: qty,
        widthMm: isSheet ? parseFloat(receiveForm.widthMm) : undefined,
        heightMm: isSheet ? parseFloat(receiveForm.heightMm) : undefined,
        batchNumber: receiveForm.batchNumber || undefined,
        location: receiveForm.location || undefined,
        costPerUnit: receiveForm.costPerUnit ? parseFloat(receiveForm.costPerUnit) : undefined,
        notes: receiveForm.notes || undefined,
      });
      toast({
        title: 'Stock received',
        description: `${items.length} item${items.length > 1 ? 's' : ''} added to inventory`,
      });
      navigate('/dashboard/inventory');
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <InventoryLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Receive Stock</h1>

        {/* Material Selection */}
        <Card>
          <CardHeader>
            <CardTitle>1. Select Material</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showNewMaterial ? (
              <>
                <div className="space-y-2">
                  <Label>Material</Label>
                  <Select value={selectedMaterialId} onValueChange={setSelectedMaterialId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a material..." />
                    </SelectTrigger>
                    <SelectContent>
                      {materials.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}{m.grade ? ` ${m.grade}` : ''}{m.thickness_mm ? ` — ${m.thickness_mm}mm` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowNewMaterial(true)}>
                  + Create New Material
                </Button>
              </>
            ) : (
              <div className="space-y-3 border rounded-lg p-4 bg-gray-50">
                <p className="font-medium">New Material</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Name *</Label>
                    <Input value={newMaterial.name} onChange={e => setNewMaterial(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Aluminum 5052" />
                  </div>
                  <div className="space-y-1">
                    <Label>Category *</Label>
                    <Select value={newMaterial.category} onValueChange={v => setNewMaterial(p => ({ ...p, category: v as MaterialCategory }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Grade</Label>
                    <Input value={newMaterial.grade} onChange={e => setNewMaterial(p => ({ ...p, grade: e.target.value }))} placeholder="e.g. 6061-T6" />
                  </div>
                  <div className="space-y-1">
                    <Label>Thickness (mm)</Label>
                    <Input type="number" step="0.1" value={newMaterial.thickness_mm} onChange={e => setNewMaterial(p => ({ ...p, thickness_mm: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Base Unit</Label>
                    <Select value={newMaterial.base_unit} onValueChange={v => setNewMaterial(p => ({ ...p, base_unit: v as BaseUnit }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNITS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Cost per unit (EUR)</Label>
                    <Input type="number" step="0.01" value={newMaterial.cost_per_unit} onChange={e => setNewMaterial(p => ({ ...p, cost_per_unit: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Supplier</Label>
                    <Input value={newMaterial.supplier} onChange={e => setNewMaterial(p => ({ ...p, supplier: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Low Stock Threshold</Label>
                    <Input type="number" step="0.1" value={newMaterial.low_stock_threshold} onChange={e => setNewMaterial(p => ({ ...p, low_stock_threshold: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={handleCreateMaterial} disabled={!newMaterial.name}>Create Material</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowNewMaterial(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Receive Details */}
        {selectedMaterialId && (
          <Card>
            <CardHeader>
              <CardTitle>2. Stock Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Quantity {isSheet ? '(sheets)' : `(${selectedMaterial?.base_unit || 'units'})`}</Label>
                  <Input type="number" min="1" value={receiveForm.quantity} onChange={e => setReceiveForm(p => ({ ...p, quantity: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Cost per {isSheet ? 'sheet' : 'unit'} (EUR)</Label>
                  <Input type="number" step="0.01" value={receiveForm.costPerUnit} onChange={e => setReceiveForm(p => ({ ...p, costPerUnit: e.target.value }))} />
                </div>
              </div>

              {isSheet && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Sheet Width (mm)</Label>
                    <Input type="number" value={receiveForm.widthMm} onChange={e => setReceiveForm(p => ({ ...p, widthMm: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Sheet Height (mm)</Label>
                    <Input type="number" value={receiveForm.heightMm} onChange={e => setReceiveForm(p => ({ ...p, heightMm: e.target.value }))} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Batch / Heat Number</Label>
                  <Input value={receiveForm.batchNumber} onChange={e => setReceiveForm(p => ({ ...p, batchNumber: e.target.value }))} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <Label>Storage Location</Label>
                  <Input value={receiveForm.location} onChange={e => setReceiveForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Rack A3" />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={receiveForm.notes} onChange={e => setReceiveForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes..." rows={2} />
              </div>

              {isSheet && receiveForm.quantity && receiveForm.widthMm && receiveForm.heightMm && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                  Will create <strong>{receiveForm.quantity}</strong> stock items, each{' '}
                  <strong>{receiveForm.widthMm} × {receiveForm.heightMm}mm</strong> ={' '}
                  <strong>{((parseFloat(receiveForm.widthMm) * parseFloat(receiveForm.heightMm)) / 1_000_000).toFixed(2)} m²</strong> per sheet.
                  Total: <strong>{((parseFloat(receiveForm.widthMm) * parseFloat(receiveForm.heightMm) * parseInt(receiveForm.quantity)) / 1_000_000).toFixed(2)} m²</strong>
                </div>
              )}

              <Button onClick={handleReceive} disabled={submitting} className="w-full">
                {submitting ? 'Receiving...' : 'Receive Stock'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </InventoryLayout>
  );
}
