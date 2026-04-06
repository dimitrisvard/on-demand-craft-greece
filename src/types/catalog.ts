// ─── Material Catalog Types ─────────────────────────────────────────────────

export type CatalogFormFactor =
  | 'sheet' | 'round_bar' | 'square_bar' | 'hex_bar' | 'flat_bar'
  | 'angle' | 'tube_welded' | 'tube_seamless' | 'fitting'
  | 'welding_consumable' | 'wire' | 'special_section';

export type CatalogStockUnit = 'kg' | 'm' | 'pcs' | 'sheet';

export type CatalogDocType =
  | 'spec_sheet' | 'dimension_table' | 'mill_cert'
  | 'safety_data' | 'brochure' | 'other';

export type StockChangeType =
  | 'receive' | 'consume' | 'adjust_up' | 'adjust_down'
  | 'scrap' | 'return' | 'transfer';

// ─── Dimension schemas per form factor ──────────────────────────────────────

export interface SheetDimensions {
  thickness_mm: number;
  width_mm: number;
  length_mm: number;
}

export interface RoundBarDimensions {
  diameter_mm: number;
  length_mm: number;
}

export interface SquareBarDimensions {
  side_mm: number;
  length_mm: number;
}

export interface HexBarDimensions {
  across_flats_mm: number;
  length_mm: number;
}

export interface FlatBarDimensions {
  thickness_mm: number;
  width_mm: number;
  length_mm: number;
}

export interface AngleDimensions {
  leg_a_mm: number;
  leg_b_mm: number;
  thickness_mm: number;
  length_mm: number;
}

export interface TubeDimensions {
  outer_diameter_mm: number;
  wall_thickness_mm: number;
  length_mm: number;
}

export interface WireDimensions {
  diameter_mm: number;
  spool_weight_kg?: number;
}

export interface FittingDimensions {
  nominal_size: string;
  type: string;
}

export interface WeldingConsumableDimensions {
  diameter_mm: number;
  length_mm?: number;
  spool_weight_kg?: number;
}

export type MaterialDimensions =
  | SheetDimensions | RoundBarDimensions | SquareBarDimensions
  | HexBarDimensions | FlatBarDimensions | AngleDimensions
  | TubeDimensions | WireDimensions | FittingDimensions
  | WeldingConsumableDimensions | Record<string, number | string>;

// ─── Table types ────────────────────────────────────────────────────────────

export interface MaterialCategory {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  image_url: string | null;
  form_factor: CatalogFormFactor;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Virtual
  material_count?: number;
}

export interface CatalogMaterial {
  id: string;
  tenant_id: string;
  category_id: string;
  name: string;
  material_grade: string;
  form_factor: CatalogFormFactor;
  dimensions: MaterialDimensions;
  surface_finish: string | null;
  standard: string | null;
  certification: string | null;
  weight_per_unit: number | null;
  stock_quantity: number;
  stock_unit: CatalogStockUnit;
  min_stock_alert: number;
  location: string | null;
  price_per_unit: number | null;
  currency: string;
  supplier: string | null;
  supplier_sku: string | null;
  is_available: boolean;
  cut_to_size: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  category?: MaterialCategory;
  documents?: MaterialDocument[];
}

export interface MaterialDocument {
  id: string;
  tenant_id: string;
  material_id: string | null;
  category_id: string | null;
  doc_type: CatalogDocType;
  title: string;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface CatalogStockLog {
  id: string;
  tenant_id: string;
  material_id: string;
  change_type: StockChangeType;
  quantity_before: number;
  quantity_change: number;
  quantity_after: number;
  reason: string | null;
  performed_by: string | null;
  created_at: string;
}

// ─── Filter types ───────────────────────────────────────────────────────────

export interface CatalogFilters {
  categorySlug?: string;
  materialGrade?: string;
  surfaceFinish?: string;
  inStockOnly?: boolean;
  search?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export const FORM_FACTOR_LABELS: Record<CatalogFormFactor, string> = {
  sheet: 'Sheets & Plates',
  round_bar: 'Round Bars',
  square_bar: 'Square Bars',
  hex_bar: 'Hex Bars',
  flat_bar: 'Flat Bars',
  angle: 'Angles',
  tube_welded: 'Tubes (Welded)',
  tube_seamless: 'Tubes (Seamless)',
  fitting: 'Fittings',
  welding_consumable: 'Welding Consumables',
  wire: 'Wire',
  special_section: 'Special Sections',
};

export const FORM_FACTOR_ICONS: Record<CatalogFormFactor, string> = {
  sheet: 'Layers',
  round_bar: 'Circle',
  square_bar: 'Square',
  hex_bar: 'Hexagon',
  flat_bar: 'Minus',
  angle: 'CornerDownRight',
  tube_welded: 'Pipette',
  tube_seamless: 'Cylinder',
  fitting: 'GitBranch',
  welding_consumable: 'Flame',
  wire: 'Cable',
  special_section: 'Shapes',
};

/** Format dimensions into a human-readable string based on form factor */
export function formatDimensions(dims: MaterialDimensions, formFactor: CatalogFormFactor): string {
  const d = dims as Record<string, number | string>;
  switch (formFactor) {
    case 'sheet':
      return `${d.thickness_mm}mm × ${d.width_mm}mm × ${d.length_mm}mm`;
    case 'round_bar':
      return `Ø${d.diameter_mm}mm × ${d.length_mm}mm`;
    case 'square_bar':
      return `${d.side_mm}mm × ${d.side_mm}mm × ${d.length_mm}mm`;
    case 'hex_bar':
      return `AF ${d.across_flats_mm}mm × ${d.length_mm}mm`;
    case 'flat_bar':
      return `${d.thickness_mm}mm × ${d.width_mm}mm × ${d.length_mm}mm`;
    case 'angle':
      return `${d.leg_a_mm}×${d.leg_b_mm}×${d.thickness_mm}mm × ${d.length_mm}mm`;
    case 'tube_welded':
    case 'tube_seamless':
      return `Ø${d.outer_diameter_mm}×${d.wall_thickness_mm}mm × ${d.length_mm}mm`;
    case 'wire':
      return `Ø${d.diameter_mm}mm${d.spool_weight_kg ? ` (${d.spool_weight_kg}kg spool)` : ''}`;
    case 'welding_consumable':
      return `Ø${d.diameter_mm}mm${d.length_mm ? ` × ${d.length_mm}mm` : ''}`;
    case 'fitting':
      return `${d.nominal_size} ${d.type || ''}`.trim();
    case 'special_section':
      return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(', ');
    default:
      return JSON.stringify(d);
  }
}

/** Dimension field definitions per form factor for admin forms */
export const DIMENSION_FIELDS: Record<CatalogFormFactor, Array<{ key: string; label: string; unit: string }>> = {
  sheet: [
    { key: 'thickness_mm', label: 'Thickness', unit: 'mm' },
    { key: 'width_mm', label: 'Width', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
  round_bar: [
    { key: 'diameter_mm', label: 'Diameter', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
  square_bar: [
    { key: 'side_mm', label: 'Side', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
  hex_bar: [
    { key: 'across_flats_mm', label: 'Across Flats', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
  flat_bar: [
    { key: 'thickness_mm', label: 'Thickness', unit: 'mm' },
    { key: 'width_mm', label: 'Width', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
  angle: [
    { key: 'leg_a_mm', label: 'Leg A', unit: 'mm' },
    { key: 'leg_b_mm', label: 'Leg B', unit: 'mm' },
    { key: 'thickness_mm', label: 'Thickness', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
  tube_welded: [
    { key: 'outer_diameter_mm', label: 'Outer Diameter', unit: 'mm' },
    { key: 'wall_thickness_mm', label: 'Wall Thickness', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
  tube_seamless: [
    { key: 'outer_diameter_mm', label: 'Outer Diameter', unit: 'mm' },
    { key: 'wall_thickness_mm', label: 'Wall Thickness', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
  fitting: [
    { key: 'nominal_size', label: 'Nominal Size', unit: '' },
    { key: 'type', label: 'Type', unit: '' },
  ],
  welding_consumable: [
    { key: 'diameter_mm', label: 'Diameter', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
    { key: 'spool_weight_kg', label: 'Spool Weight', unit: 'kg' },
  ],
  wire: [
    { key: 'diameter_mm', label: 'Diameter', unit: 'mm' },
    { key: 'spool_weight_kg', label: 'Spool Weight', unit: 'kg' },
  ],
  special_section: [
    { key: 'profile', label: 'Profile', unit: '' },
    { key: 'dimension_a_mm', label: 'Dimension A', unit: 'mm' },
    { key: 'dimension_b_mm', label: 'Dimension B', unit: 'mm' },
    { key: 'length_mm', label: 'Length', unit: 'mm' },
  ],
};
