/**
 * Manufacturing-relevant CPV codes for Microns Hub tender monitoring
 */

export const MANUFACTURING_CPV_CODES = {
  // Core manufacturing machinery
  '42000000': 'Industrial machinery',
  '42600000': 'Machine tools',
  '42610000': 'Lathes, boring and milling machines',
  '42620000': 'Lathes, boring machines',
  '42630000': 'Metal-working machine tools',
  '42640000': 'Machine tools for working materials',
  '42900000': 'Various general/special-purpose machinery',
  '42990000': 'Miscellaneous special-purpose machines',
  '42910000': 'Distilling, filtering or rectifying machinery',
  '42920000': 'Cleaning machines for bottles, packing machinery',

  // Metal products & fabrication
  '44000000': 'Construction structures and materials',
  '44300000': 'Cable, wire and related products',
  '44310000': 'Wire products',
  '44316000': 'Ironmongery',
  '44500000': 'Tools, locks, keys, hinges, fasteners',
  '44510000': 'Tools',
  '44530000': 'Fasteners',
  '44540000': 'Chains',
  '44600000': 'Tanks, reservoirs and containers; central-heating radiators',
  '14700000': 'Base metals',
  '14710000': 'Iron and steel',
  '14720000': 'Aluminium, nickel, scandium, titanium, vanadium',
  '14730000': 'Lead, zinc and tin',

  // Precision equipment & instruments
  '38000000': 'Laboratory, optical and precision equipment',
  '38400000': 'Instruments for checking physical characteristics',
  '38500000': 'Checking and testing apparatus',
  '38540000': 'Machines and apparatus for testing',
  '38550000': 'Meters',
  '38900000': 'Miscellaneous evaluation or testing instruments',

  // Medical & lab (often precision machined)
  '33100000': 'Medical equipment',
  '33190000': 'Miscellaneous medical devices',
  '33140000': 'Medical consumables',
  '33180000': 'Functional support',

  // Transport & automotive components
  '34000000': 'Transport equipment and auxiliary products',
  '34300000': 'Parts and accessories for vehicles',
  '34310000': 'Engines and engine parts',
  '34320000': 'Mechanical spare parts',
  '34330000': 'Spare parts for commercial vehicles',

  // Defense (precision components)
  '35000000': 'Security, fire-fighting, police and defense equipment',
  '35100000': 'Emergency and security equipment',
  '35200000': 'Police equipment',
  '35300000': 'Weapons, ammunition and associated parts',
  '35600000': 'Aerospace defense equipment',

  // Engineering services (manufacturing-adjacent)
  '71300000': 'Engineering services',
  '71320000': 'Engineering design services',
  '71330000': 'Miscellaneous engineering services',

  // Repair & maintenance (needs machined parts)
  '50530000': 'Repair and maintenance of machinery',
  '50500000': 'Repair services for pumps, valves, taps, metal containers',
  '50510000': 'Repair and maintenance of pumps, valves, taps',
  '50520000': 'Repair and maintenance services for industrial machinery',

  // Plastics & rubber
  '19500000': 'Rubber and plastic materials',
  '19510000': 'Rubber products',
  '19520000': 'Plastic products',

  // Aerospace
  '34700000': 'Aircraft and spacecraft',
  '34730000': 'Parts for aircraft',
};

/**
 * CPV prefixes for fast prefix matching (first 2 digits)
 */
export const MANUFACTURING_CPV_PREFIXES = [
  '42', // Industrial machinery
  '44', // Construction materials/metal products
  '14', // Base metals
  '38', // Precision equipment
  '33', // Medical (precision)
  '34', // Transport components
  '35', // Defense
  '50', // Repair/maintenance
  '19', // Plastics/rubber
];

/**
 * Check if a CPV code is manufacturing-relevant
 */
export function isMfgCpv(cpvCode) {
  if (!cpvCode) return false;
  const clean = cpvCode.replace(/[^0-9]/g, '');
  // Exact match in dictionary
  if (clean in MANUFACTURING_CPV_CODES) return true;
  // Prefix match (first 2 digits)
  const prefix2 = clean.substring(0, 2);
  if (MANUFACTURING_CPV_PREFIXES.includes(prefix2)) return true;
  return false;
}
