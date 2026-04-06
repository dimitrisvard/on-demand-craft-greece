-- ============================================================================
-- Seed Data: Material Catalog — Realistic stainless steel, aluminum, carbon steel
-- ============================================================================

-- ─── CATEGORIES ─────────────────────────────────────────────────────────────

INSERT INTO material_categories (id, tenant_id, name, slug, description, icon, form_factor, sort_order) VALUES
  ('c0000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Sheets & Plates', 'sheets-plates', 'Flat rolled sheets and plates in various grades and thicknesses', 'Layers', 'sheet', 1),
  ('c0000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Round Bars', 'round-bars', 'Solid round bars and rods for machining and fabrication', 'Circle', 'round_bar', 2),
  ('c0000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Square Bars', 'square-bars', 'Solid square bars for structural and machining applications', 'Square', 'square_bar', 3),
  ('c0000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001',
   'Hex Bars', 'hex-bars', 'Hexagonal bars for precision machining', 'Hexagon', 'hex_bar', 4),
  ('c0000001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001',
   'Flat Bars', 'flat-bars', 'Flat bars and strips in various widths and thicknesses', 'Minus', 'flat_bar', 5),
  ('c0000001-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001',
   'Angles', 'angles', 'L-shaped angle profiles for structural applications', 'CornerDownRight', 'angle', 6),
  ('c0000001-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001',
   'Tubes (Welded)', 'tubes-welded', 'Welded tubes and pipes in round, square, and rectangular sections', 'Pipette', 'tube_welded', 7),
  ('c0000001-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001',
   'Tubes (Seamless)', 'tubes-seamless', 'Seamless tubes for high-pressure and precision applications', 'Cylinder', 'tube_seamless', 8),
  ('c0000001-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001',
   'Special Sections', 'special-sections', 'Special profiles, channels, T-bars, and custom sections', 'Shapes', 'special_section', 9),
  ('c0000001-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001',
   'Fittings', 'fittings', 'Pipe fittings, flanges, elbows, tees, and reducers', 'GitBranch', 'fitting', 10),
  ('c0000001-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001',
   'Welding Consumables', 'welding-consumables', 'Welding rods, wire, and electrodes', 'Flame', 'welding_consumable', 11),
  ('c0000001-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001',
   'Wire', 'wire', 'Wire products for tying, mesh, and general use', 'Cable', 'wire', 12);


-- ─── STAINLESS STEEL SHEETS ────────────────────────────────────────────────

INSERT INTO catalog_materials (tenant_id, category_id, name, material_grade, form_factor, dimensions, surface_finish, standard, certification, weight_per_unit, stock_quantity, stock_unit, min_stock_alert, location, price_per_unit, supplier, is_available, cut_to_size, notes) VALUES
-- AISI 304 Sheets
('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'SS Sheet 304 1.0mm 1000×2000', 'AISI 304', 'sheet',
 '{"thickness_mm": 1.0, "width_mm": 1000, "length_mm": 2000}',
 '2B', 'DIN EN 10088-2', 'EN 10204 3.1', 15.8, 45, 'sheet', 10, 'A1-R1',
 42.50, 'Technometal SA', true, true, 'Standard stock item. 6m lengths available on request.'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'SS Sheet 304 1.5mm 1000×2000', 'AISI 304', 'sheet',
 '{"thickness_mm": 1.5, "width_mm": 1000, "length_mm": 2000}',
 '2B', 'DIN EN 10088-2', 'EN 10204 3.1', 23.7, 32, 'sheet', 8, 'A1-R1',
 62.80, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'SS Sheet 304 2.0mm 1250×2500', 'AISI 304', 'sheet',
 '{"thickness_mm": 2.0, "width_mm": 1250, "length_mm": 2500}',
 '2B', 'DIN EN 10088-2', 'EN 10204 3.1', 49.1, 18, 'sheet', 5, 'A1-R2',
 128.00, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'SS Sheet 304 3.0mm 1500×3000', 'AISI 304', 'sheet',
 '{"thickness_mm": 3.0, "width_mm": 1500, "length_mm": 3000}',
 '#4 Satin', 'DIN EN 10088-2', 'EN 10204 3.1', 107.1, 8, 'sheet', 3, 'A1-R3',
 285.00, 'Technometal SA', true, true, 'Satin finish, one side protective film.'),

-- AISI 316L Sheets
('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'SS Sheet 316L 1.0mm 1000×2000', 'AISI 316L', 'sheet',
 '{"thickness_mm": 1.0, "width_mm": 1000, "length_mm": 2000}',
 '2B', 'DIN EN 10088-2', 'EN 10204 3.1', 15.9, 25, 'sheet', 5, 'A1-R4',
 58.00, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'SS Sheet 316L 2.0mm 1250×2500', 'AISI 316L', 'sheet',
 '{"thickness_mm": 2.0, "width_mm": 1250, "length_mm": 2500}',
 'BA', 'DIN EN 10088-2', 'EN 10204 3.1', 49.6, 12, 'sheet', 3, 'A1-R4',
 175.00, 'Technometal SA', true, true, 'Bright Annealed finish'),

-- Aluminum Sheets
('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'Al Sheet 5083-H111 2.0mm 1250×2500', 'Al 5083-H111', 'sheet',
 '{"thickness_mm": 2.0, "width_mm": 1250, "length_mm": 2500}',
 'Mill finish', 'EN 573-3', 'EN 10204 3.1', 16.9, 20, 'sheet', 5, 'B1-R1',
 68.00, 'Elval Halcor', true, true, 'Marine grade aluminum'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'Al Sheet 6061-T6 3.0mm 1250×2500', 'Al 6061-T6', 'sheet',
 '{"thickness_mm": 3.0, "width_mm": 1250, "length_mm": 2500}',
 'Mill finish', 'EN 573-3', 'EN 10204 2.2', 25.3, 15, 'sheet', 4, 'B1-R1',
 95.00, 'Elval Halcor', true, true, NULL),

-- Carbon Steel Sheets
('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'CS Sheet S235JR 2.0mm 1500×3000', 'S235JR', 'sheet',
 '{"thickness_mm": 2.0, "width_mm": 1500, "length_mm": 3000}',
 'Mill finish', 'EN 10025-2', 'EN 10204 2.2', 70.7, 30, 'sheet', 10, 'C1-R1',
 85.00, 'Sidenor SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'CS Sheet S355J2 5.0mm 1500×3000', 'S355J2', 'sheet',
 '{"thickness_mm": 5.0, "width_mm": 1500, "length_mm": 3000}',
 'Mill finish', 'EN 10025-2', 'EN 10204 3.1', 176.6, 6, 'sheet', 2, 'C1-R2',
 210.00, 'Sidenor SA', true, true, 'Heavy plate, crane handling required'),


-- ─── ROUND BARS ────────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002',
 'SS Round Bar 304 Ø10mm', 'AISI 304', 'round_bar',
 '{"diameter_mm": 10, "length_mm": 6000}',
 'Bright drawn', 'DIN EN 10088-3', 'EN 10204 3.1', 3.7, 50, 'pcs', 15, 'A2-R1',
 12.50, 'Technometal SA', true, true, 'Standard 6m lengths'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002',
 'SS Round Bar 304 Ø20mm', 'AISI 304', 'round_bar',
 '{"diameter_mm": 20, "length_mm": 6000}',
 'Bright drawn', 'DIN EN 10088-3', 'EN 10204 3.1', 14.8, 35, 'pcs', 10, 'A2-R1',
 48.00, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002',
 'SS Round Bar 304 Ø30mm', 'AISI 304', 'round_bar',
 '{"diameter_mm": 30, "length_mm": 6000}',
 'Peeled', 'DIN EN 10088-3', 'EN 10204 3.1', 33.3, 20, 'pcs', 5, 'A2-R2',
 108.00, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002',
 'SS Round Bar 316L Ø16mm', 'AISI 316L', 'round_bar',
 '{"diameter_mm": 16, "length_mm": 6000}',
 'Bright drawn', 'DIN EN 10088-3', 'EN 10204 3.1', 9.5, 25, 'pcs', 8, 'A2-R3',
 42.00, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002',
 'Al Round Bar 6061-T6 Ø25mm', 'Al 6061-T6', 'round_bar',
 '{"diameter_mm": 25, "length_mm": 3000}',
 'Extruded', 'EN 755-2', 'EN 10204 2.2', 3.3, 40, 'pcs', 10, 'B2-R1',
 15.50, 'Elval Halcor', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002',
 'CS Round Bar C45 Ø40mm', 'C45', 'round_bar',
 '{"diameter_mm": 40, "length_mm": 6000}',
 'Black', 'EN 10083-2', 'EN 10204 3.1', 59.2, 15, 'pcs', 5, 'C2-R1',
 85.00, 'Sidenor SA', true, true, 'Heat treatable steel'),


-- ─── HEX BARS ──────────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000004',
 'SS Hex Bar 304 AF17mm', 'AISI 304', 'hex_bar',
 '{"across_flats_mm": 17, "length_mm": 3000}',
 'Bright drawn', 'DIN EN 10088-3', 'EN 10204 3.1', 5.9, 30, 'pcs', 10, 'A4-R1',
 22.00, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000004',
 'SS Hex Bar 304 AF24mm', 'AISI 304', 'hex_bar',
 '{"across_flats_mm": 24, "length_mm": 3000}',
 'Bright drawn', 'DIN EN 10088-3', 'EN 10204 3.1', 11.8, 18, 'pcs', 5, 'A4-R1',
 44.00, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000004',
 'SS Hex Bar 316L AF19mm', 'AISI 316L', 'hex_bar',
 '{"across_flats_mm": 19, "length_mm": 3000}',
 'Bright drawn', 'DIN EN 10088-3', 'EN 10204 3.1', 7.4, 22, 'pcs', 5, 'A4-R2',
 35.00, 'Technometal SA', true, true, NULL),


-- ─── FLAT BARS ─────────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000005',
 'SS Flat Bar 304 20×3mm', 'AISI 304', 'flat_bar',
 '{"thickness_mm": 3, "width_mm": 20, "length_mm": 6000}',
 'Bright drawn', 'DIN EN 10088-3', 'EN 10204 3.1', 2.8, 40, 'pcs', 10, 'A5-R1',
 9.50, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000005',
 'SS Flat Bar 304 40×5mm', 'AISI 304', 'flat_bar',
 '{"thickness_mm": 5, "width_mm": 40, "length_mm": 6000}',
 'Hot rolled', 'DIN EN 10088-3', 'EN 10204 3.1', 9.4, 25, 'pcs', 5, 'A5-R1',
 31.00, 'Technometal SA', true, true, NULL),


-- ─── ANGLES ────────────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000006',
 'SS Angle 304 30×30×3mm', 'AISI 304', 'angle',
 '{"leg_a_mm": 30, "leg_b_mm": 30, "thickness_mm": 3, "length_mm": 6000}',
 'Mill finish', 'DIN EN 10088-3', NULL, 8.0, 20, 'pcs', 5, 'A6-R1',
 28.00, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000006',
 'SS Angle 304 50×50×5mm', 'AISI 304', 'angle',
 '{"leg_a_mm": 50, "leg_b_mm": 50, "thickness_mm": 5, "length_mm": 6000}',
 'Mill finish', 'DIN EN 10088-3', NULL, 22.2, 12, 'pcs', 3, 'A6-R1',
 72.00, 'Technometal SA', true, true, NULL),


-- ─── WELDED TUBES ──────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000007',
 'SS Tube Welded 304 Ø25×1.5mm', 'AISI 304', 'tube_welded',
 '{"outer_diameter_mm": 25, "wall_thickness_mm": 1.5, "length_mm": 6000}',
 'Polished 320 grit', 'DIN EN 10296-2', 'EN 10204 3.1', 2.6, 60, 'pcs', 15, 'A7-R1',
 14.50, 'Technometal SA', true, true, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000007',
 'SS Tube Welded 304 Ø42.4×2.0mm', 'AISI 304', 'tube_welded',
 '{"outer_diameter_mm": 42.4, "wall_thickness_mm": 2.0, "length_mm": 6000}',
 '#4 Satin', 'DIN EN 10296-2', 'EN 10204 3.1', 5.9, 35, 'pcs', 10, 'A7-R1',
 32.00, 'Technometal SA', true, true, 'Handrail tube standard'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000007',
 'SS Tube Welded 316L Ø33.7×2.0mm', 'AISI 316L', 'tube_welded',
 '{"outer_diameter_mm": 33.7, "wall_thickness_mm": 2.0, "length_mm": 6000}',
 'Polished 320 grit', 'DIN EN 10296-2', 'EN 10204 3.1', 4.7, 20, 'pcs', 5, 'A7-R2',
 38.00, 'Technometal SA', true, true, NULL),


-- ─── SEAMLESS TUBES ────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000008',
 'SS Tube Seamless 304 Ø21.3×2.77mm', 'AISI 304', 'tube_seamless',
 '{"outer_diameter_mm": 21.3, "wall_thickness_mm": 2.77, "length_mm": 6000}',
 'Pickled', 'ASTM A312', 'EN 10204 3.1', 7.6, 15, 'pcs', 3, 'A8-R1',
 52.00, 'Sandvik / Tubinox', true, false, 'Schedule 40'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000008',
 'SS Tube Seamless 316L Ø33.4×3.38mm', 'AISI 316L', 'tube_seamless',
 '{"outer_diameter_mm": 33.4, "wall_thickness_mm": 3.38, "length_mm": 6000}',
 'Pickled', 'ASTM A312', 'EN 10204 3.1', 14.9, 8, 'pcs', 2, 'A8-R1',
 98.00, 'Sandvik / Tubinox', true, false, 'Schedule 40. Lead time 2-3 weeks if not in stock.'),


-- ─── WELDING CONSUMABLES ───────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000011',
 'TIG Rod 308L Ø1.6mm', 'ER308L', 'welding_consumable',
 '{"diameter_mm": 1.6, "length_mm": 1000}',
 NULL, 'AWS A5.9', NULL, 5.0, 80, 'kg', 20, 'D1-R1',
 18.50, 'Lincoln Electric', true, false, '5kg packs'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000011',
 'TIG Rod 308L Ø2.4mm', 'ER308L', 'welding_consumable',
 '{"diameter_mm": 2.4, "length_mm": 1000}',
 NULL, 'AWS A5.9', NULL, 5.0, 60, 'kg', 15, 'D1-R1',
 17.00, 'Lincoln Electric', true, false, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000011',
 'TIG Rod 316L Ø2.0mm', 'ER316L', 'welding_consumable',
 '{"diameter_mm": 2.0, "length_mm": 1000}',
 NULL, 'AWS A5.9', NULL, 5.0, 40, 'kg', 10, 'D1-R2',
 24.00, 'ESAB', true, false, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000011',
 'MIG Wire 308LSi Ø0.8mm 15kg', 'ER308LSi', 'welding_consumable',
 '{"diameter_mm": 0.8, "spool_weight_kg": 15}',
 NULL, 'AWS A5.9', NULL, 15.0, 10, 'pcs', 3, 'D1-R3',
 145.00, 'Lincoln Electric', true, false, '15kg spool'),


-- ─── WIRE ──────────────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000012',
 'SS Tying Wire 304 Ø0.8mm', 'AISI 304', 'wire',
 '{"diameter_mm": 0.8, "spool_weight_kg": 2}',
 'Bright', NULL, NULL, 2.0, 25, 'pcs', 5, 'D2-R1',
 12.00, 'Technometal SA', true, false, '2kg coils'),


-- ─── FITTINGS ──────────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000010',
 'SS Elbow 90° 304 DN25', 'AISI 304', 'fitting',
 '{"nominal_size": "DN25", "type": "Elbow 90°"}',
 NULL, 'DIN EN 10253', NULL, 0.15, 50, 'pcs', 10, 'E1-R1',
 4.80, 'Inoxal SA', true, false, 'Butt weld type'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000010',
 'SS Tee Equal 304 DN25', 'AISI 304', 'fitting',
 '{"nominal_size": "DN25", "type": "Tee Equal"}',
 NULL, 'DIN EN 10253', NULL, 0.22, 30, 'pcs', 5, 'E1-R1',
 7.50, 'Inoxal SA', true, false, NULL),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000010',
 'SS Reducer 304 DN50/DN25', 'AISI 304', 'fitting',
 '{"nominal_size": "DN50/DN25", "type": "Concentric Reducer"}',
 NULL, 'DIN EN 10253', NULL, 0.35, 20, 'pcs', 5, 'E1-R2',
 11.00, 'Inoxal SA', true, false, NULL),

-- Low stock / out of stock items for realistic variety
('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002',
 'SS Round Bar 304 Ø50mm', 'AISI 304', 'round_bar',
 '{"diameter_mm": 50, "length_mm": 6000}',
 'Peeled', 'DIN EN 10088-3', 'EN 10204 3.1', 92.4, 2, 'pcs', 5, 'A2-R3',
 298.00, 'Technometal SA', true, true, 'Low stock — reorder placed'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
 'SS Sheet 304L 4.0mm 1500×3000', 'AISI 304L', 'sheet',
 '{"thickness_mm": 4.0, "width_mm": 1500, "length_mm": 3000}',
 '2B', 'DIN EN 10088-2', 'EN 10204 3.1', 142.8, 0, 'sheet', 2, 'A1-R3',
 380.00, 'Technometal SA', false, true, 'Currently out of stock. Expected delivery: 2 weeks.'),

('00000000-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000003',
 'SS Square Bar 304 20×20mm', 'AISI 304', 'square_bar',
 '{"side_mm": 20, "length_mm": 6000}',
 'Bright drawn', 'DIN EN 10088-3', 'EN 10204 3.1', 18.8, 15, 'pcs', 5, 'A3-R1',
 62.00, 'Technometal SA', true, true, NULL);
