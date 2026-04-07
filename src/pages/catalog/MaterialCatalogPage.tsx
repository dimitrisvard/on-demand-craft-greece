import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LayoutGrid, Table2, ArrowLeft, Plus, Home, Menu, Package, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import CatalogSidebar from '@/components/catalog/CatalogSidebar';
import CatalogFilters from '@/components/catalog/CatalogFilters';
import MaterialTable from '@/components/catalog/MaterialTable';
import DimensionTableView from '@/components/catalog/DimensionTableView';
import {
  getCategoriesWithCounts,
  getCatalogMaterials,
  getCatalogMaterialsByCategoryId,
  getDistinctGrades,
  getDistinctFinishes,
  getCategoryBySlug,
  upsertCatalogMaterial,
} from '@/utils/catalogApi';
import type { MaterialCategory, CatalogMaterial } from '@/types/catalog';
import { FORM_FACTOR_LABELS, DIMENSION_FIELDS } from '@/types/catalog';
import type { CatalogFormFactor, CatalogStockUnit } from '@/types/catalog';

export default function MaterialCatalogPage() {
  const { categorySlug } = useParams<{ categorySlug: string }>();

  // Data
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [materials, setMaterials] = useState<CatalogMaterial[]>([]);
  const [activeCategory, setActiveCategory] = useState<MaterialCategory | null>(null);
  const [grades, setGrades] = useState<string[]>([]);
  const [finishes, setFinishes] = useState<string[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingMats, setLoadingMats] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [selectedFinish, setSelectedFinish] = useState('all');
  const [inStockOnly, setInStockOnly] = useState(false);

  // View mode
  const [view, setView] = useState<'table' | 'dimensions'>('table');

  // New Material dialog
  const [isNewMaterialOpen, setIsNewMaterialOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const emptyForm = (): Record<string, any> => ({
    name: '', material_grade: '', form_factor: 'sheet' as CatalogFormFactor,
    category_id: '', dimensions: {}, surface_finish: '', standard: '',
    stock_quantity: 0, stock_unit: 'pcs' as CatalogStockUnit, min_stock_alert: 0,
    price_per_unit: null, currency: 'EUR', supplier: '', is_available: true, cut_to_size: false,
  });
  const [materialForm, setMaterialForm] = useState<Record<string, any>>(emptyForm());

  const currentFormFactor = (materialForm.form_factor || 'sheet') as CatalogFormFactor;
  const dimFields = DIMENSION_FIELDS[currentFormFactor] || [];
  const currentDims = (materialForm.dimensions || {}) as Record<string, number | string>;

  function setDimField(key: string, value: string) {
    setMaterialForm(prev => ({
      ...prev,
      dimensions: { ...(prev.dimensions || {}), [key]: isNaN(Number(value)) ? value : Number(value) },
    }));
  }

  function handleFormFactorChange(ff: CatalogFormFactor) {
    const matchingCat = categories.find(c => c.form_factor === ff);
    setMaterialForm(prev => ({
      ...prev, form_factor: ff, category_id: matchingCat?.id || prev.category_id || '', dimensions: {},
    }));
  }

  async function handleSaveNewMaterial() {
    if (!materialForm.name || !materialForm.material_grade || !materialForm.category_id) {
      toast({ title: 'Error', description: 'Name, grade, and category are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await upsertCatalogMaterial({
        name: materialForm.name,
        material_grade: materialForm.material_grade,
        form_factor: materialForm.form_factor,
        category_id: materialForm.category_id,
        dimensions: materialForm.dimensions || {},
        surface_finish: materialForm.surface_finish || null,
        standard: materialForm.standard || null,
        stock_quantity: Number(materialForm.stock_quantity) || 0,
        stock_unit: materialForm.stock_unit || 'pcs',
        min_stock_alert: Number(materialForm.min_stock_alert) || 0,
        price_per_unit: materialForm.price_per_unit ? Number(materialForm.price_per_unit) : null,
        currency: materialForm.currency || 'EUR',
        supplier: materialForm.supplier || null,
        is_available: materialForm.is_available ?? true,
        cut_to_size: materialForm.cut_to_size ?? false,
      });
      toast({ title: 'Success', description: 'Material created successfully' });
      setIsNewMaterialOpen(false);
      setMaterialForm(emptyForm());
      // Reload materials
      const mats = activeCategory
        ? await getCatalogMaterialsByCategoryId(activeCategory.id)
        : await getCatalogMaterials();
      setMaterials(mats);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to create material', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  // Load categories once
  useEffect(() => {
    getCategoriesWithCounts()
      .then(setCategories)
      .catch(console.error)
      .finally(() => setLoadingCats(false));
  }, []);

  // Load materials when category changes
  useEffect(() => {
    setLoadingMats(true);
    setSelectedGrade('all');
    setSelectedFinish('all');
    setSearch('');

    const loadData = async () => {
      try {
        let cat: MaterialCategory | null = null;
        let mats: CatalogMaterial[];

        if (categorySlug) {
          cat = await getCategoryBySlug(categorySlug);
          setActiveCategory(cat);
          mats = cat ? await getCatalogMaterialsByCategoryId(cat.id) : [];
        } else {
          setActiveCategory(null);
          mats = await getCatalogMaterials();
        }

        setMaterials(mats);

        // Get filter options
        const catId = cat?.id;
        const [g, f] = await Promise.all([
          getDistinctGrades(catId),
          getDistinctFinishes(catId),
        ]);
        setGrades(g);
        setFinishes(f);
      } catch (err) {
        console.error('Failed to load materials:', err);
        setMaterials([]);
      } finally {
        setLoadingMats(false);
      }
    };

    loadData();
  }, [categorySlug]);

  // Client-side filtering
  const filteredMaterials = useMemo(() => {
    let result = materials;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.material_grade.toLowerCase().includes(q) ||
        (m.supplier || '').toLowerCase().includes(q)
      );
    }

    if (selectedGrade && selectedGrade !== 'all') {
      result = result.filter(m => m.material_grade === selectedGrade);
    }

    if (selectedFinish && selectedFinish !== 'all') {
      result = result.filter(m => m.surface_finish === selectedFinish);
    }

    if (inStockOnly) {
      result = result.filter(m => m.stock_quantity > 0);
    }

    return result;
  }, [materials, search, selectedGrade, selectedFinish, inStockOnly]);

  return (
    <div className="min-h-screen bg-slate-100 flex">
      {/* Sidebar */}
      <CatalogSidebar categories={categories} loading={loadingCats} />

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        {/* Top bar */}
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                {activeCategory ? activeCategory.name : 'All Materials'}
              </h1>
              {activeCategory?.description && (
                <p className="text-xs text-slate-500 mt-0.5">{activeCategory.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/dashboard">
              <Button size="sm" variant="default" className="h-8 text-xs gap-1.5 bg-brand-primary hover:bg-brand-secondary text-white">
                <Menu className="h-3.5 w-3.5" />
                Main Menu
              </Button>
            </Link>
            {/* View toggle */}
            <div className="bg-slate-100 rounded-md p-0.5 flex">
              <button
                onClick={() => setView('table')}
                className={`p-1.5 rounded ${view === 'table' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                title="List view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView('dimensions')}
                className={`p-1.5 rounded ${view === 'dimensions' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                title="Dimension table"
              >
                <Table2 className="h-4 w-4" />
              </button>
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white" onClick={() => { setMaterialForm(emptyForm()); setIsNewMaterialOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
              New Material
            </Button>
            <Link to="/dashboard/materials/admin">
              <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-slate-500">
                <Package className="h-3 w-3" />
                Manage All
              </Button>
            </Link>
          </div>
        </div>

        {/* Category hero image (if available) */}
        {activeCategory?.image_url && (
          <div className="relative h-40 bg-slate-800 overflow-hidden">
            <img
              src={activeCategory.image_url}
              alt={activeCategory.name}
              className="w-full h-full object-cover opacity-60"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900/80 to-transparent" />
            <div className="absolute bottom-4 left-6">
              <h2 className="text-2xl font-bold text-white">{activeCategory.name}</h2>
              {activeCategory.description && (
                <p className="text-sm text-slate-300 mt-1">{activeCategory.description}</p>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Filters */}
          <CatalogFilters
            search={search}
            onSearchChange={setSearch}
            grades={grades}
            selectedGrade={selectedGrade}
            onGradeChange={setSelectedGrade}
            finishes={finishes}
            selectedFinish={selectedFinish}
            onFinishChange={setSelectedFinish}
            inStockOnly={inStockOnly}
            onInStockChange={setInStockOnly}
            totalCount={filteredMaterials.length}
          />

          {/* Material display */}
          {view === 'table' ? (
            <MaterialTable materials={filteredMaterials} loading={loadingMats} />
          ) : (
            activeCategory ? (
              <DimensionTableView
                materials={filteredMaterials}
                formFactor={activeCategory.form_factor}
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
                <p className="text-sm text-slate-500">Select a category to view the dimension table.</p>
              </div>
            )
          )}
        </div>
      </main>

      {/* New Material Dialog */}
      <Dialog open={isNewMaterialOpen} onOpenChange={setIsNewMaterialOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Package className="h-5 w-5 text-brand-primary" />
              Add New Material
            </DialogTitle>
            <p className="text-sm text-slate-500 mt-1">Fill in the details below to add a new material to your catalog.</p>
          </DialogHeader>

          <div className="space-y-5 py-3">
            {/* Section: Basic Info */}
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Basic Information</h3>
              <div className="bg-slate-50 rounded-lg p-4 space-y-3 border border-slate-200">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Material Name *</Label>
                    <Input
                      value={materialForm.name || ''}
                      onChange={e => setMaterialForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g., SS Round Bar 304 Ø20mm"
                      className="mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Material Grade *</Label>
                    <Input
                      value={materialForm.material_grade || ''}
                      onChange={e => setMaterialForm(p => ({ ...p, material_grade: e.target.value }))}
                      placeholder="e.g., AISI 304"
                      className="mt-1 bg-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Form Factor *</Label>
                    <Select
                      value={materialForm.form_factor || 'sheet'}
                      onValueChange={(v) => handleFormFactorChange(v as CatalogFormFactor)}
                    >
                      <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(FORM_FACTOR_LABELS).map(([val, label]) => (
                          <SelectItem key={val} value={val}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Category *</Label>
                    <Select
                      value={materialForm.category_id || ''}
                      onValueChange={v => setMaterialForm(p => ({ ...p, category_id: v }))}
                    >
                      <SelectTrigger className="mt-1 bg-white"><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {categories.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Dimensions */}
            {dimFields.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Dimensions</h3>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <div className="grid grid-cols-3 gap-3">
                    {dimFields.map(f => (
                      <div key={f.key}>
                        <Label className="text-[11px] text-slate-600">{f.label} {f.unit && `(${f.unit})`}</Label>
                        <Input
                          type={f.unit ? 'number' : 'text'}
                          value={currentDims[f.key] ?? ''}
                          onChange={e => setDimField(f.key, e.target.value)}
                          className="mt-0.5 h-8 text-sm bg-white"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Section: Stock & Pricing */}
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock & Pricing</h3>
              <div className="bg-slate-50 rounded-lg p-4 space-y-3 border border-slate-200">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Stock Quantity</Label>
                    <Input
                      type="number"
                      value={materialForm.stock_quantity || ''}
                      onChange={e => setMaterialForm(p => ({ ...p, stock_quantity: Number(e.target.value) }))}
                      className="mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Stock Unit</Label>
                    <Select
                      value={materialForm.stock_unit || 'pcs'}
                      onValueChange={v => setMaterialForm(p => ({ ...p, stock_unit: v }))}
                    >
                      <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pcs">Pieces</SelectItem>
                        <SelectItem value="kg">Kilograms</SelectItem>
                        <SelectItem value="m">Meters</SelectItem>
                        <SelectItem value="sheet">Sheets</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Min Stock Alert</Label>
                    <Input
                      type="number"
                      value={materialForm.min_stock_alert || ''}
                      onChange={e => setMaterialForm(p => ({ ...p, min_stock_alert: Number(e.target.value) }))}
                      className="mt-1 bg-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Price per Unit</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={materialForm.price_per_unit || ''}
                      onChange={e => setMaterialForm(p => ({ ...p, price_per_unit: e.target.value }))}
                      placeholder="0.00"
                      className="mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Currency</Label>
                    <Select
                      value={materialForm.currency || 'EUR'}
                      onValueChange={v => setMaterialForm(p => ({ ...p, currency: v }))}
                    >
                      <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Supplier</Label>
                    <Input
                      value={materialForm.supplier || ''}
                      onChange={e => setMaterialForm(p => ({ ...p, supplier: e.target.value }))}
                      placeholder="Supplier name"
                      className="mt-1 bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Additional */}
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Additional Details</h3>
              <div className="bg-slate-50 rounded-lg p-4 space-y-3 border border-slate-200">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Surface Finish</Label>
                    <Input
                      value={materialForm.surface_finish || ''}
                      onChange={e => setMaterialForm(p => ({ ...p, surface_finish: e.target.value }))}
                      placeholder="e.g., 2B, BA, No.4"
                      className="mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Standard</Label>
                    <Input
                      value={materialForm.standard || ''}
                      onChange={e => setMaterialForm(p => ({ ...p, standard: e.target.value }))}
                      placeholder="e.g., EN 10088-2"
                      className="mt-1 bg-white"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-6 pt-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={materialForm.is_available ?? true}
                      onCheckedChange={v => setMaterialForm(p => ({ ...p, is_available: v }))}
                    />
                    <Label className="text-xs">Available</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={materialForm.cut_to_size ?? false}
                      onCheckedChange={v => setMaterialForm(p => ({ ...p, cut_to_size: v }))}
                    />
                    <Label className="text-xs">Cut to Size</Label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsNewMaterialOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveNewMaterial} disabled={saving} className="bg-brand-primary hover:bg-brand-secondary text-white gap-1.5">
              {saving ? 'Creating...' : 'Create Material'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
