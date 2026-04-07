-- Add price_per_kg column to catalog_materials
-- This allows admin to set the price per kilogram for each material,
-- which is used in nesting sessions to calculate sheet cost from weight.

ALTER TABLE catalog_materials
  ADD COLUMN IF NOT EXISTS price_per_kg numeric(12,4) DEFAULT NULL;

COMMENT ON COLUMN catalog_materials.price_per_kg IS 'Price per kilogram in the material currency, set by admin for cost calculations in nesting';
