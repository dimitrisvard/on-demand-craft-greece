import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Upload, Download, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  getCategories,
  getCatalogMaterials,
  upsertCatalogMaterial,
  deleteCatalogMaterial,
  adjustCatalogStock,
  bulkImportMaterials,
} from '@/utils/catalogApi';
import { formatDimensions, DIMENSION_FIELDS, FORM_FACTOR_LABELS } from '@/types/catalog';
import type { MaterialCategory, CatalogMaterial, CatalogFormFactor, CatalogStockUnit, StockChangeType } from '@/types/catalog';

// ─── Empty form state ───────────────────────────────────────────────────────

const emptyForm = (): Partial<CatalogMaterial> => ({
  name: '',
  material_grade: '',
  form_factor: 'sheet' as CatalogFormFactor,
  category_id: '',
  dimensions: {},
  surface_finish: '',
  standard: '',
  certification: '',
  weight_per_unit: null,
  stock_quantity: 0,
  stock_unit: 'pcs' as CatalogStockUnit,
  min_stock_alert: 0,
  location: '',
  price_per_unit: null,
  price_per_kg: null,
  currency: 'EUR',
  supplier: '',
  supplier_sku: '',
  is_available: true,
  cut_to_size: false,
  notes: '',
});

export default function MaterialAdminPage() {
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [materials, setMaterials] = useState<CatalogMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [form, setForm] = useState<Partial<CatalogMaterial>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stockTarget, setStockTarget] = useState<CatalogMaterial | null>(null);
  const [stockChange, setStockChange] = useState({ quantity: 0, type: 'receive' as StockChangeType, reason: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, mats] = await Promise.all([getCategories(), getCatalogMaterials()]);
      setCategories(cats);
      setMaterials(mats);
    } catch (err) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Form handlers ──────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(mat: CatalogMaterial) {
    setEditingId(mat.id);
    setForm({ ...mat });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name || !form.material_grade || !form.category_id) {
      toast.error('Name, grade, and category are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name!,
        material_grade: form.material_grade!,
        form_factor: form.form_factor!,
        category_id: form.category_id!,
      };
      if (editingId) (payload as any).id = editingId;
      await upsertCatalogMaterial(payload);
      toast.success(editingId ? 'Material updated' : 'Material created');
      setDialogOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this material? This cannot be undone.')) return;
    try {
      await deleteCatalogMaterial(id);
      toast.success('Material deleted');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  }

  // ─── Stock adjustment ───────────────────────────────────────────────────

  function openStockAdjust(mat: CatalogMaterial) {
    setStockTarget(mat);
    setStockChange({ quantity: 0, type: 'receive', reason: '' });
    setStockDialogOpen(true);
  }

  async function handleStockAdjust() {
    if (!stockTarget || stockChange.quantity === 0) return;
    try {
      const qty = stockChange.type === 'consume' || stockChange.type === 'scrap'
        ? -Math.abs(stockChange.quantity)
        : Math.abs(stockChange.quantity);
      await adjustCatalogStock(stockTarget.id, qty, stockChange.type, stockChange.reason);
      toast.success('Stock adjusted');
      setStockDialogOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Adjustment failed');
    }
  }

  // ─── Bulk CSV import ────────────────────────────────────────────────────

  async function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const Papa = await import('papaparse');
    Papa.default.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data as Record<string, string>[];
          const mapped = rows.map(row => ({
            name: row.name || '',
            material_grade: row.material_grade || row.grade || '',
            form_factor: (row.form_factor || 'sheet') as CatalogFormFactor,
            category_id: row.category_id || '',
            dimensions: tryParseJSON(row.dimensions) || {},
            surface_finish: row.surface_finish || null,
            standard: row.standard || null,
            certification: row.certification || null,
            stock_quantity: Number(row.stock_quantity) || 0,
            stock_unit: (row.stock_unit || 'pcs') as CatalogStockUnit,
            min_stock_alert: Number(row.min_stock_alert) || 0,
            location: row.location || null,
            price_per_unit: Number(row.price_per_unit) || null,
            supplier: row.supplier || null,
            is_available: row.is_available !== 'false',
            cut_to_size: row.cut_to_size === 'true',
          }));

          const valid = mapped.filter(m => m.name && m.material_grade && m.category_id);
          if (valid.length === 0) {
            toast.error('No valid rows found. Ensure name, material_grade, and category_id columns exist.');
            return;
          }

          const count = await bulkImportMaterials(valid);
          toast.success(`Imported ${count} materials`);
          setImportDialogOpen(false);
          loadData();
        } catch (err: any) {
          toast.error(err.message || 'Import failed');
        }
      },
    });
  }

  // ─── Dynamic dimension fields ───────────────────────────────────────────

  const currentFormFactor = (form.form_factor || 'sheet') as CatalogFormFactor;
  const dimFields = DIMENSION_FIELDS[currentFormFactor] || [];
  const currentDims = (form.dimensions || {}) as Record<string, number | string>;

  function setDimField(key: string, value: string) {
    setForm(prev => ({
      ...prev,
      dimensions: { ...(prev.dimensions as Record<string, any> || {}), [key]: isNaN(Number(value)) ? value : Number(value) },
    }));
  }

  // When form_factor changes, also set category to matching one
  function handleFormFactorChange(ff: CatalogFormFactor) {
    const matchingCat = categories.find(c => c.form_factor === ff);
    setForm(prev => ({
      ...prev,
      form_factor: ff,
      category_id: matchingCat?.id || prev.category_id || '',
      dimensions: {},
    }));
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard/materials" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Material Management</h1>
            <p className="text-xs text-slate-500">Add, edit, and manage raw material inventory</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportDialogOpen(true)} className="gap-1 text-xs h-8">
            <Upload className="h-3 w-3" /> Import CSV
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-1 text-xs h-8 bg-slate-800 hover:bg-slate-700">
            <Plus className="h-3 w-3" /> Add Material
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Grade</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Dimensions</TableHead>
                  <TableHead className="text-xs text-right">Stock</TableHead>
                  <TableHead className="text-xs text-right">Price/Unit</TableHead>
                  <TableHead className="text-xs text-right">Price/kg</TableHead>
                  <TableHead className="text-xs text-center">Available</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-slate-400">
                      No materials yet. Click "Add Material" to get started.
                    </TableCell>
                  </TableRow>
                ) : materials.map(mat => (
                  <TableRow key={mat.id} className="hover:bg-slate-50">
                    <TableCell className="text-sm font-medium">{mat.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">{mat.material_grade}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{mat.category?.name || '—'}</TableCell>
                    <TableCell className="text-xs font-mono text-slate-600">
                      {formatDimensions(mat.dimensions, mat.form_factor)}
                    </TableCell>
                    <TableCell className="text-right">
                      <button onClick={() => openStockAdjust(mat)} className="hover:underline">
                        <span className="text-sm font-medium">{mat.stock_quantity}</span>
                        <span className="text-[10px] text-slate-400 ml-1">{mat.stock_unit}</span>
                      </button>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {mat.price_per_unit
                        ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(mat.price_per_unit)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {(mat as any).price_per_kg
                        ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((mat as any).price_per_kg) + '/kg'
                        : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-block h-2 w-2 rounded-full ${mat.is_available ? 'bg-emerald-500' : 'bg-red-400'}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(mat)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDelete(mat.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ─── Create/Edit Dialog ──────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Material' : 'Add New Material'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Row 1 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Name *</Label>
                <Input
                  value={form.name || ''}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="SS Round Bar 304 Ø20mm"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Material Grade *</Label>
                <Input
                  value={form.material_grade || ''}
                  onChange={e => setForm(p => ({ ...p, material_grade: e.target.value }))}
                  placeholder="AISI 304"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Row 2 — Form factor + Category */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Form Factor *</Label>
                <Select
                  value={form.form_factor || 'sheet'}
                  onValueChange={(v) => handleFormFactorChange(v as CatalogFormFactor)}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FORM_FACTOR_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Category *</Label>
                <Select
                  value={form.category_id || ''}
                  onValueChange={v => setForm(p => ({ ...p, category_id: v }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dynamic dimension fields */}
            <div>
              <Label className="text-xs font-semibold">Dimensions</Label>
              <div className="grid grid-cols-3 gap-3 mt-1">
                {dimFields.map(f => (
                  <div key={f.key}>
                    <Label className="text-[11px] text-slate-500">{f.label} {f.unit && `(${f.unit})`}</Label>
                    <Input
                      type={f.unit ? 'number' : 'text'}
                      value={currentDims[f.key] ?? ''}
                      onChange={e => setDimField(f.key, e.target.value)}
                      className="mt-0.5 h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Row 3 — Specs */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Surface Finish</Label>
                <Input
                  value={form.surface_finish || ''}
                  onChange={e => setForm(p => ({ ...p, surface_finish: e.target.value }))}
                  placeholder="2B, BA, #4 Satin"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Standard</Label>
                <Input
                  value={form.standard || ''}
                  onChange={e => setForm(p => ({ ...p, standard: e.target.value }))}
                  placeholder="DIN EN 10088"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Certification</Label>
                <Input
                  value={form.certification || ''}
                  onChange={e => setForm(p => ({ ...p, certification: e.target.value }))}
                  placeholder="EN 10204 3.1"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Row 4 — Stock & pricing */}
            <div className="grid grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">Stock Qty</Label>
                <Input
                  type="number"
                  value={form.stock_quantity ?? 0}
                  onChange={e => setForm(p => ({ ...p, stock_quantity: Number(e.target.value) }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Select
                  value={form.stock_unit || 'pcs'}
                  onValueChange={v => setForm(p => ({ ...p, stock_unit: v as CatalogStockUnit }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">pcs</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="m">m</SelectItem>
                    <SelectItem value="sheet">sheet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Price/Unit (EUR)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.price_per_unit ?? ''}
                  onChange={e => setForm(p => ({ ...p, price_per_unit: e.target.value ? Number(e.target.value) : null }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Price/kg (EUR)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={(form as any).price_per_kg ?? ''}
                  onChange={e => setForm(p => ({ ...p, price_per_kg: e.target.value ? Number(e.target.value) : null }))}
                  className="mt-1"
                  placeholder="e.g. 3.50"
                />
              </div>
              <div>
                <Label className="text-xs">Min Stock Alert</Label>
                <Input
                  type="number"
                  value={form.min_stock_alert ?? 0}
                  onChange={e => setForm(p => ({ ...p, min_stock_alert: Number(e.target.value) }))}
                  className="mt-1"
                />
              </div>
            </div>

            {/* Row 5 — Supplier & location */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Supplier</Label>
                <Input
                  value={form.supplier || ''}
                  onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Supplier SKU</Label>
                <Input
                  value={form.supplier_sku || ''}
                  onChange={e => setForm(p => ({ ...p, supplier_sku: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Warehouse Location</Label>
                <Input
                  value={form.location || ''}
                  onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
                  placeholder="A3-R2"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Row 6 — Weight & toggles */}
            <div className="grid grid-cols-3 gap-4 items-end">
              <div>
                <Label className="text-xs">Weight per Unit (kg)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.weight_per_unit ?? ''}
                  onChange={e => setForm(p => ({ ...p, weight_per_unit: e.target.value ? Number(e.target.value) : null }))}
                  className="mt-1"
                />
              </div>
              <div className="flex items-center gap-3 pb-2">
                <Switch
                  checked={form.is_available ?? true}
                  onCheckedChange={v => setForm(p => ({ ...p, is_available: v }))}
                />
                <Label className="text-xs">Available</Label>
              </div>
              <div className="flex items-center gap-3 pb-2">
                <Switch
                  checked={form.cut_to_size ?? false}
                  onCheckedChange={v => setForm(p => ({ ...p, cut_to_size: v }))}
                />
                <Label className="text-xs">Cut to Size</Label>
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={form.notes || ''}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="mt-1"
                placeholder="Stock vs made-to-order, MOQ, special handling..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-slate-800 hover:bg-slate-700">
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Stock Adjustment Dialog ─────────────────────────────────────── */}
      <Dialog open={stockDialogOpen} onOpenChange={setStockDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Stock — {stockTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-center text-2xl font-bold text-slate-800">
              {stockTarget?.stock_quantity} <span className="text-sm font-normal text-slate-400">{stockTarget?.stock_unit}</span>
            </div>
            <div>
              <Label className="text-xs">Change Type</Label>
              <Select value={stockChange.type} onValueChange={v => setStockChange(p => ({ ...p, type: v as StockChangeType }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="receive">Receive</SelectItem>
                  <SelectItem value="consume">Consume</SelectItem>
                  <SelectItem value="adjust_up">Adjust Up</SelectItem>
                  <SelectItem value="adjust_down">Adjust Down</SelectItem>
                  <SelectItem value="scrap">Scrap</SelectItem>
                  <SelectItem value="return">Return</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Quantity</Label>
              <Input
                type="number"
                value={stockChange.quantity || ''}
                onChange={e => setStockChange(p => ({ ...p, quantity: Number(e.target.value) }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Reason</Label>
              <Input
                value={stockChange.reason}
                onChange={e => setStockChange(p => ({ ...p, reason: e.target.value }))}
                placeholder="Delivery from supplier, production use..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleStockAdjust} className="bg-slate-800 hover:bg-slate-700">Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Import Dialog ───────────────────────────────────────────────── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Materials from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-500">
              Upload a CSV file with columns: <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">name, material_grade, form_factor, category_id, dimensions (JSON), surface_finish, stock_quantity, stock_unit, price_per_unit, supplier, location</code>
            </p>
            <Input type="file" accept=".csv" onChange={handleCSVImport} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function tryParseJSON(str: string | undefined): Record<string, any> | null {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
