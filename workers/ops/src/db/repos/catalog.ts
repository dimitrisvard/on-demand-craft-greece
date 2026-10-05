// public.catalog_materials (src/sql/20260406_create_material_catalog.sql, price_per_kg from
// src/sql/20260407_add_price_per_kg.sql) through the Db port: the material prices of the quote calculator. Read only.
//
// Rules
//   - Only rows that are available (is_available not false) are read; the grade, thickness and form match happens in
//     pricing/materials.ts matchCatalog(), because grades are written in many forms ('AISI 304', '1.4301', 'V2A').
//   - At most MAX_CATALOG_ROWS rows of the tenant are read (the live catalogue has tens of rows).

import type { Db } from '../postgrest';
import type { CatalogMaterialRow } from '../../pricing/types';

export const MAX_CATALOG_ROWS = 2000;

export async function loadCatalog(db: Db, tenantId: string): Promise<CatalogMaterialRow[]> {
  const rows = await db.select<CatalogMaterialRow & Record<string, unknown>>('catalog_materials', {
    columns: 'id,name,material_grade,form_factor,dimensions,weight_per_unit,stock_unit,price_per_unit,price_per_kg,currency,is_available',
    filters: [['tenant_id', 'eq', tenantId]],
    order: [{ column: 'id', ascending: true }],
    limit: MAX_CATALOG_ROWS,
  });
  return rows.filter((r) => r.is_available !== false);
}
