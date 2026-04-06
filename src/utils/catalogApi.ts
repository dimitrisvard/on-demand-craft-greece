/**
 * Material Catalog API — direct Supabase client calls
 */

import { supabase } from '@/integrations/supabase/client';
import type {
  MaterialCategory,
  CatalogMaterial,
  MaterialDocument,
  CatalogStockLog,
  CatalogFilters,
  StockChangeType,
} from '@/types/catalog';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ─── Categories ─────────────────────────────────────────────────────────────

export async function getCategories(): Promise<MaterialCategory[]> {
  const { data, error } = await supabase
    .from('material_categories')
    .select('*')
    .eq('tenant_id', TENANT_ID)
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw new Error(error.message);
  return (data || []) as unknown as MaterialCategory[];
}

export async function getCategoryBySlug(slug: string): Promise<MaterialCategory | null> {
  const { data, error } = await supabase
    .from('material_categories')
    .select('*')
    .eq('tenant_id', TENANT_ID)
    .eq('slug', slug)
    .single();

  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return (data as unknown as MaterialCategory) || null;
}

export async function upsertCategory(
  category: Partial<MaterialCategory> & { name: string; slug: string; form_factor: string }
): Promise<MaterialCategory> {
  const payload = { ...category, tenant_id: TENANT_ID };
  const { data, error } = category.id
    ? await supabase.from('material_categories').update(payload).eq('id', category.id).select().single()
    : await supabase.from('material_categories').insert(payload).select().single();

  if (error) throw new Error(error.message);
  return data as unknown as MaterialCategory;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('material_categories').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── Materials ──────────────────────────────────────────────────────────────

export async function getCatalogMaterials(filters?: CatalogFilters): Promise<CatalogMaterial[]> {
  let query = supabase
    .from('catalog_materials')
    .select('*, category:material_categories(*)')
    .eq('tenant_id', TENANT_ID);

  if (filters?.categorySlug) {
    // First get category ID from slug
    const cat = await getCategoryBySlug(filters.categorySlug);
    if (cat) {
      query = query.eq('category_id', cat.id);
    } else {
      return [];
    }
  }

  if (filters?.materialGrade) {
    query = query.eq('material_grade', filters.materialGrade);
  }

  if (filters?.surfaceFinish) {
    query = query.eq('surface_finish', filters.surfaceFinish);
  }

  if (filters?.inStockOnly) {
    query = query.gt('stock_quantity', 0);
  }

  if (filters?.search) {
    query = query.or(
      `name.ilike.%${filters.search}%,material_grade.ilike.%${filters.search}%,supplier.ilike.%${filters.search}%`
    );
  }

  const { data, error } = await query.order('material_grade').order('name');

  if (error) throw new Error(error.message);
  return (data || []) as unknown as CatalogMaterial[];
}

export async function getCatalogMaterialsByCategoryId(categoryId: string): Promise<CatalogMaterial[]> {
  const { data, error } = await supabase
    .from('catalog_materials')
    .select('*, category:material_categories(*)')
    .eq('tenant_id', TENANT_ID)
    .eq('category_id', categoryId)
    .order('material_grade')
    .order('name');

  if (error) throw new Error(error.message);
  return (data || []) as unknown as CatalogMaterial[];
}

export async function getCatalogMaterialById(id: string): Promise<CatalogMaterial | null> {
  const { data, error } = await supabase
    .from('catalog_materials')
    .select('*, category:material_categories(*), documents:material_documents(*)')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return (data as unknown as CatalogMaterial) || null;
}

export async function upsertCatalogMaterial(
  material: Partial<CatalogMaterial> & { name: string; material_grade: string; form_factor: string; category_id: string }
): Promise<CatalogMaterial> {
  const payload = { ...material, tenant_id: TENANT_ID };
  // Remove joined fields
  delete (payload as any).category;
  delete (payload as any).documents;

  const { data, error } = material.id
    ? await supabase.from('catalog_materials').update(payload).eq('id', material.id).select().single()
    : await supabase.from('catalog_materials').insert(payload).select().single();

  if (error) throw new Error(error.message);
  return data as unknown as CatalogMaterial;
}

export async function deleteCatalogMaterial(id: string): Promise<void> {
  const { error } = await supabase.from('catalog_materials').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── Stock Adjustments ──────────────────────────────────────────────────────

export async function adjustCatalogStock(
  materialId: string,
  quantityChange: number,
  changeType: StockChangeType,
  reason?: string
): Promise<void> {
  // Get current quantity
  const { data: mat, error: fetchErr } = await supabase
    .from('catalog_materials')
    .select('stock_quantity')
    .eq('id', materialId)
    .single();

  if (fetchErr) throw new Error(fetchErr.message);

  const before = Number((mat as any).stock_quantity) || 0;
  const after = before + quantityChange;

  if (after < 0) throw new Error('Stock cannot go below zero');

  // Update stock
  const { error: updateErr } = await supabase
    .from('catalog_materials')
    .update({ stock_quantity: after })
    .eq('id', materialId);

  if (updateErr) throw new Error(updateErr.message);

  // Log the change
  const { error: logErr } = await supabase.from('catalog_stock_log').insert({
    tenant_id: TENANT_ID,
    material_id: materialId,
    change_type: changeType,
    quantity_before: before,
    quantity_change: quantityChange,
    quantity_after: after,
    reason: reason || null,
  });

  if (logErr) console.error('Failed to log stock change:', logErr);
}

// ─── Stock Log ──────────────────────────────────────────────────────────────

export async function getStockLog(materialId: string): Promise<CatalogStockLog[]> {
  const { data, error } = await supabase
    .from('catalog_stock_log')
    .select('*')
    .eq('material_id', materialId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data || []) as unknown as CatalogStockLog[];
}

// ─── Documents ──────────────────────────────────────────────────────────────

export async function getDocuments(params: { materialId?: string; categoryId?: string }): Promise<MaterialDocument[]> {
  let query = supabase
    .from('material_documents')
    .select('*')
    .eq('tenant_id', TENANT_ID);

  if (params.materialId) query = query.eq('material_id', params.materialId);
  if (params.categoryId) query = query.eq('category_id', params.categoryId);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []) as unknown as MaterialDocument[];
}

export async function uploadDocument(doc: {
  materialId?: string;
  categoryId?: string;
  docType: string;
  title: string;
  file: File;
}): Promise<MaterialDocument> {
  // Upload file to Supabase Storage
  const filePath = `catalog-docs/${Date.now()}_${doc.file.name}`;
  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(filePath, doc.file);

  if (uploadErr) throw new Error(uploadErr.message);

  const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);

  const { data, error } = await supabase.from('material_documents').insert({
    tenant_id: TENANT_ID,
    material_id: doc.materialId || null,
    category_id: doc.categoryId || null,
    doc_type: doc.docType,
    title: doc.title,
    file_url: urlData.publicUrl,
    file_size_bytes: doc.file.size,
    mime_type: doc.file.type,
  }).select().single();

  if (error) throw new Error(error.message);
  return data as unknown as MaterialDocument;
}

export async function deleteDocument(id: string): Promise<void> {
  const { error } = await supabase.from('material_documents').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── Distinct filter values ─────────────────────────────────────────────────

export async function getDistinctGrades(categoryId?: string): Promise<string[]> {
  let query = supabase
    .from('catalog_materials')
    .select('material_grade')
    .eq('tenant_id', TENANT_ID);

  if (categoryId) query = query.eq('category_id', categoryId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const grades = [...new Set((data || []).map((d: any) => d.material_grade))].sort();
  return grades;
}

export async function getDistinctFinishes(categoryId?: string): Promise<string[]> {
  let query = supabase
    .from('catalog_materials')
    .select('surface_finish')
    .eq('tenant_id', TENANT_ID)
    .not('surface_finish', 'is', null);

  if (categoryId) query = query.eq('category_id', categoryId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const finishes = [...new Set((data || []).map((d: any) => d.surface_finish))].sort();
  return finishes;
}

// ─── Bulk import ────────────────────────────────────────────────────────────

export async function bulkImportMaterials(
  materials: Array<Partial<CatalogMaterial> & { name: string; material_grade: string; form_factor: string; category_id: string }>
): Promise<number> {
  const payload = materials.map(m => ({ ...m, tenant_id: TENANT_ID }));
  const { data, error } = await supabase
    .from('catalog_materials')
    .insert(payload)
    .select('id');

  if (error) throw new Error(error.message);
  return (data || []).length;
}

// ─── Category material counts ───────────────────────────────────────────────

export async function getCategoriesWithCounts(): Promise<MaterialCategory[]> {
  const [cats, materials] = await Promise.all([
    getCategories(),
    supabase
      .from('catalog_materials')
      .select('category_id')
      .eq('tenant_id', TENANT_ID),
  ]);

  if (materials.error) throw new Error(materials.error.message);

  const countMap: Record<string, number> = {};
  (materials.data || []).forEach((m: any) => {
    countMap[m.category_id] = (countMap[m.category_id] || 0) + 1;
  });

  return cats.map(c => ({ ...c, material_count: countMap[c.id] || 0 }));
}
