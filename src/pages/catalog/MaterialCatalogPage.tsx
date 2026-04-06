import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LayoutGrid, Table2, ArrowLeft, Plus, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
} from '@/utils/catalogApi';
import type { MaterialCategory, CatalogMaterial } from '@/types/catalog';

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
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                <Home className="h-3 w-3" />
                Dashboard
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
            <Link to="/dashboard/materials/admin">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                <Plus className="h-3 w-3" />
                Add Material
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
    </div>
  );
}
