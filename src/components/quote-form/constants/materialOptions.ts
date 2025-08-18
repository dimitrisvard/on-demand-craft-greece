export interface MaterialOption {
  value: string;
  label: string;
  subtypes: Array<{ value: string; label: string }>;
}

export const materialOptions: MaterialOption[] = [
  {
    value: 'aluminum',
    label: 'Aluminum',
    subtypes: [
      { value: 'any', label: 'Any available aluminum grade' },
      { value: '2007', label: 'Aluminium 2007 / 3.1645 / Al‑CuMgPb' },
      { value: '2017A', label: 'Aluminium 2017A / 3.1325 / Al‑Cu4Mg' },
      { value: '5083', label: 'Aluminium 5083 / 3.3547 / Al‑Mg4.5Mn' },
      { value: '5754', label: 'Aluminium 5754 / 3.3535 / AlMg3' },
      { value: '6060', label: 'Aluminium 6060 / 3.3206 / Al‑MgSi' },
      { value: '6061', label: 'Aluminium 6061 / 3.3211 / Al‑Mg1SiCu' },
      { value: '6082', label: 'Aluminium 6082 / 3.2315 / Al‑Si1Mg' },
      { value: '7075', label: 'Aluminium 7075 / 3.4365 / Al‑Zn6MgCu' },
    ],
  },
  {
    value: 'stainless-steel',
    label: 'Stainless Steel',
    subtypes: [
      { value: 'any', label: 'Any available stainless steel grade' },
      { value: '303', label: 'Stainless Steel 303 / 1.4305 / X10CrNiS18‑9' },
      { value: '304', label: 'Stainless Steel 304 / 1.4301 / X5CrNi18.10' },
      { value: '304L', label: 'Stainless Steel 304L / 1.4307 / X2CrNi18‑9' },
      { value: '316', label: 'Stainless Steel 316 / 1.4401 / X5CrNiMo17‑12‑2' },
      { value: '316L', label: 'Stainless Steel 316L / 1.4404 / X2CrNiMo17‑12‑2' },
      { value: '316Ti', label: 'Stainless Steel 316Ti / 1.4571 / X6CrNiMoTi17‑12‑2' },
    ],
  },
  {
    value: 'steel',
    label: 'Steel',
    subtypes: [
      { value: 'any', label: 'Any available steel grade' },
      { value: '1.0038', label: 'Steel 1.0038 / S235JR / 1.0037' },
      { value: '1.0577', label: 'Steel 1.0577 / S355J2 / St52' },
      { value: 'C35', label: 'Steel C35 / 1.0501' },
      { value: '1.0511', label: 'Steel 1.0511 / C40' },
      { value: 'C45', label: 'Steel C45 / 1.0503 / C45E / Ck45 / 1.1191' },
      { value: 'C45U', label: 'Steel C45U / 1.1730 / C45W' },
      { value: '1.2379', label: 'Steel 1.2379 / X155CrVMo12‑1' },
      { value: '1.2842', label: 'Steel 1.2842 / 90MnCrV8' },
      { value: '1.7131', label: 'Steel 1.7131 / 16MnCr5' },
      { value: '1.7139', label: 'Steel 1.7139 / 16MnCrS5' },
      { value: '1.7147', label: 'Steel 1.7147 / 20MnCr5 / 1.2162 / 21MnCr5' },
      { value: '1.7149', label: 'Steel 1.7149 / 20MnCr5' },
      { value: '1.7218', label: 'Steel 1.7218 / 25CrMo4' },
      { value: '1.7225', label: 'Steel 1.7225 / 42CrMo4' },
      { value: '1.7227', label: 'Steel 1.7227 / 42CrMoS4' },
    ],
  },
  {
    value: 'plastic',
    label: 'Plastic',
    subtypes: [
      { value: 'abs', label: 'ABS' },
      { value: 'pmma', label: 'Acrylic / PMMA' },
      { value: 'peek', label: 'PEEK' },
      { value: 'peek-gf', label: 'PEEK glass‑filled' },
      { value: 'ptfe', label: 'PTFE / Teflon' },
      { value: 'pa6', label: 'Nylon 6 / PA 6' },
      { value: 'pc', label: 'PC (Polycarbonate)' },
      { value: 'pp', label: 'Polypropylene (PP)' },
      { value: 'pe-uhmw', label: 'UHMW PE' },
    ],
  },
  {
    value: 'pom',
    label: 'POM',
    subtypes: [
      { value: 'delrin', label: 'POM / Delrin acetal' },
    ],
  },
  {
    value: 'copper',
    label: 'Copper',
    subtypes: [
      { value: 'e-cu', label: 'Copper E‑Cu57 / E‑Cu58 / Cu‑ETP / 2.0060 / 2.0065 / CW004A' },
    ],
  },
  {
    value: 'brass',
    label: 'Brass',
    subtypes: [
      { value: 'ms58', label: 'Brass Ms58 / 2.0401 / CuZn39Pb3 / CW614N' },
    ],
  },
  {
    value: 'titanium',
    label: 'Titanium',
    subtypes: [
      { value: 'grade2', label: 'Titan Grade 2 / 3.7035' },
      { value: 'grade5', label: 'Titan Grade 5 / 3.7164 / 3.7165 / Ti‑6Al‑4V' },
    ],
  },
];

export const surfaceRoughnessOptions = [
  { value: 'standard', label: 'Standard (3.2 µm Ra)' },
  { value: '0.4', label: '0.4 µm Ra' },
  { value: '0.8', label: '0.8 µm Ra' },
  { value: '1.6', label: '1.6 µm Ra' },
];

export const toleranceOptions = [
  { value: 'iso2768-m', label: 'ISO 2768 – medium' },
  { value: 'iso2768-f', label: 'ISO 2768 – fine' },
  { value: 'iso286-8', label: 'ISO 286 – grade 8' },
  { value: 'iso286-7', label: 'ISO 286 – grade 7' },
  { value: 'iso286-6', label: 'ISO 286 – grade 6' },
];

export const surfaceTreatmentOptions = [
  { value: 'anodizing', label: 'Anodizing' },
  { value: 'powder-coating', label: 'Powder Coating' },
  { value: 'hard-anodizing', label: 'Hard Anodizing' },
  { value: 'black-finishing', label: 'Black Finishing' },
  { value: 'passivating', label: 'Passivating' },
  { value: 'nickel-plating', label: 'Nickel Plating' },
  { value: 'galvanizing', label: 'Galvanizing (Zinc Plating)' },
  { value: 'hardening', label: 'Hardening' },
  { value: 'quenching-tempering', label: 'Quenching and Tempering' },
  { value: 'case-hardening', label: 'Case Hardening' },
  { value: 'nitriding', label: 'Nitriding (Gas and Plasma)' },
  { value: 'laser-engraving', label: 'Laser Engraving' },
  { value: 'polishing', label: 'Polishing' },
  { value: 'grinding', label: 'Grinding' },
  { value: 'sandblasting', label: 'Sandblasting' },
  { value: 'glass-bead-blasting', label: 'Glass Bead Blasting' },
  { value: 'other', label: 'Other (specify)' },
];
