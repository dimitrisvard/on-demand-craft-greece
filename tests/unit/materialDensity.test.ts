import { describe, it, expect } from '@jest/globals';
import { getMaterialDensity, materialDensities } from '../../src/utils/materialDensity';

describe('Material Density Lookup', () => {
  it('should return correct density for exact material name', () => {
    expect(getMaterialDensity('aluminum 6061')).toBe(2.70);
    expect(getMaterialDensity('stainless steel 304')).toBe(8.00);
    expect(getMaterialDensity('titanium')).toBe(4.51);
  });

  it('should handle case-insensitive lookup', () => {
    expect(getMaterialDensity('Aluminum 6061')).toBe(2.70);
    expect(getMaterialDensity('STEEL')).toBe(7.85);
    expect(getMaterialDensity('Brass')).toBe(8.50);
  });

  it('should handle partial/fuzzy matching', () => {
    // 'aluminum' should match general aluminum entry
    expect(getMaterialDensity('aluminum')).toBe(2.70);
    // 'steel' should match general steel entry
    expect(getMaterialDensity('steel')).toBe(7.85);
  });

  it('should return null for unknown materials', () => {
    expect(getMaterialDensity('unobtanium')).toBeNull();
    expect(getMaterialDensity('dark matter')).toBeNull();
  });

  it('should return null for empty input', () => {
    expect(getMaterialDensity('')).toBeNull();
  });

  it('should have density values for common manufacturing materials', () => {
    const requiredMaterials = ['aluminum', 'steel', 'stainless steel', 'brass', 'copper', 'titanium', 'abs', 'nylon'];
    for (const mat of requiredMaterials) {
      expect(materialDensities[mat]).toBeDefined();
      expect(materialDensities[mat].density).toBeGreaterThan(0);
    }
  });

  it('should have valid category for all materials', () => {
    for (const [, info] of Object.entries(materialDensities)) {
      expect(info.category).toBeTruthy();
      expect(info.name).toBeTruthy();
      expect(info.density).toBeGreaterThan(0);
    }
  });
});
