// Material density database (g/cm³) for weight estimation
// Sources: engineering handbooks, manufacturer specs

export interface MaterialInfo {
  name: string;
  density: number; // g/cm³
  category: string;
}

export const materialDensities: Record<string, MaterialInfo> = {
  // Aluminum alloys
  'aluminum': { name: 'Aluminum (General)', density: 2.70, category: 'Aluminum' },
  'aluminum 6061': { name: 'Aluminum 6061', density: 2.70, category: 'Aluminum' },
  'aluminum 6082': { name: 'Aluminum 6082', density: 2.71, category: 'Aluminum' },
  'aluminum 7075': { name: 'Aluminum 7075', density: 2.81, category: 'Aluminum' },
  'aluminum 5083': { name: 'Aluminum 5083', density: 2.66, category: 'Aluminum' },
  'aluminum 2024': { name: 'Aluminum 2024', density: 2.78, category: 'Aluminum' },
  'al 6061': { name: 'Aluminum 6061', density: 2.70, category: 'Aluminum' },
  'al 7075': { name: 'Aluminum 7075', density: 2.81, category: 'Aluminum' },

  // Steels
  'steel': { name: 'Steel (General)', density: 7.85, category: 'Steel' },
  'carbon steel': { name: 'Carbon Steel', density: 7.85, category: 'Steel' },
  'mild steel': { name: 'Mild Steel', density: 7.85, category: 'Steel' },
  'stainless steel': { name: 'Stainless Steel', density: 8.00, category: 'Steel' },
  'stainless steel 304': { name: 'SS 304', density: 8.00, category: 'Steel' },
  'stainless steel 316': { name: 'SS 316', density: 8.00, category: 'Steel' },
  'ss 304': { name: 'SS 304', density: 8.00, category: 'Steel' },
  'ss 316': { name: 'SS 316', density: 8.00, category: 'Steel' },
  'tool steel': { name: 'Tool Steel', density: 7.80, category: 'Steel' },
  'spring steel': { name: 'Spring Steel', density: 7.85, category: 'Steel' },

  // Copper & alloys
  'copper': { name: 'Copper', density: 8.96, category: 'Copper' },
  'brass': { name: 'Brass', density: 8.50, category: 'Copper' },
  'bronze': { name: 'Bronze', density: 8.80, category: 'Copper' },

  // Titanium
  'titanium': { name: 'Titanium', density: 4.51, category: 'Titanium' },
  'titanium grade 5': { name: 'Ti Grade 5 (Ti-6Al-4V)', density: 4.43, category: 'Titanium' },
  'ti-6al-4v': { name: 'Ti-6Al-4V', density: 4.43, category: 'Titanium' },

  // Plastics
  'abs': { name: 'ABS', density: 1.05, category: 'Plastic' },
  'pla': { name: 'PLA', density: 1.24, category: 'Plastic' },
  'nylon': { name: 'Nylon (PA)', density: 1.14, category: 'Plastic' },
  'pa': { name: 'Nylon (PA)', density: 1.14, category: 'Plastic' },
  'pa6': { name: 'PA6', density: 1.14, category: 'Plastic' },
  'pa66': { name: 'PA66', density: 1.15, category: 'Plastic' },
  'peek': { name: 'PEEK', density: 1.32, category: 'Plastic' },
  'pom': { name: 'POM (Delrin)', density: 1.41, category: 'Plastic' },
  'delrin': { name: 'POM (Delrin)', density: 1.41, category: 'Plastic' },
  'acetal': { name: 'POM (Acetal)', density: 1.41, category: 'Plastic' },
  'polycarbonate': { name: 'Polycarbonate', density: 1.20, category: 'Plastic' },
  'pc': { name: 'Polycarbonate', density: 1.20, category: 'Plastic' },
  'ptfe': { name: 'PTFE (Teflon)', density: 2.17, category: 'Plastic' },
  'teflon': { name: 'PTFE (Teflon)', density: 2.17, category: 'Plastic' },
  'pp': { name: 'Polypropylene', density: 0.91, category: 'Plastic' },
  'polypropylene': { name: 'Polypropylene', density: 0.91, category: 'Plastic' },
  'pe': { name: 'Polyethylene', density: 0.95, category: 'Plastic' },
  'hdpe': { name: 'HDPE', density: 0.95, category: 'Plastic' },
  'resin': { name: 'Resin (SLA)', density: 1.15, category: 'Plastic' },

  // Other metals
  'zinc': { name: 'Zinc', density: 7.13, category: 'Other Metal' },
  'magnesium': { name: 'Magnesium', density: 1.74, category: 'Other Metal' },
  'nickel': { name: 'Nickel', density: 8.91, category: 'Other Metal' },
  'inconel': { name: 'Inconel', density: 8.44, category: 'Other Metal' },
};

/**
 * Look up material density by name (fuzzy match)
 */
export function getMaterialDensity(materialName: string): number | null {
  if (!materialName) return null;

  const lower = materialName.toLowerCase().trim();

  // Direct match
  if (materialDensities[lower]) {
    return materialDensities[lower].density;
  }

  // Partial match - find best match
  for (const [key, info] of Object.entries(materialDensities)) {
    if (lower.includes(key) || key.includes(lower)) {
      return info.density;
    }
  }

  return null;
}

/**
 * Calculate weight from volume and material
 * @param volumeMm3 Volume in mm³
 * @param materialName Material name string
 * @returns Weight in grams, or null if material not found
 */
export function calculateWeight(volumeMm3: number, materialName: string): number | null {
  const density = getMaterialDensity(materialName);
  if (density === null) return null;

  // Convert mm³ to cm³ (divide by 1000) then multiply by density (g/cm³)
  return (volumeMm3 / 1000) * density;
}

/**
 * Format volume for display
 */
export function formatVolume(volumeMm3: number): string {
  if (volumeMm3 >= 1_000_000) {
    return `${(volumeMm3 / 1_000_000_000).toFixed(2)} dm³`;
  }
  if (volumeMm3 >= 1000) {
    return `${(volumeMm3 / 1000).toFixed(2)} cm³`;
  }
  return `${volumeMm3.toFixed(1)} mm³`;
}

/**
 * Format weight for display
 */
export function formatWeight(weightGrams: number): string {
  if (weightGrams >= 1000) {
    return `${(weightGrams / 1000).toFixed(2)} kg`;
  }
  return `${weightGrams.toFixed(1)} g`;
}
