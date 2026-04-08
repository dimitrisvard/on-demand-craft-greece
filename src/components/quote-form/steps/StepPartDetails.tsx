import React, { useState, useEffect, useRef, useMemo, Suspense, useCallback } from 'react';
import { FormikProps, FieldArray } from 'formik';
import { Plus, Trash2, FileText, X, Box as BoxIcon, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { materialOptions as staticMaterialOptions, surfaceRoughnessOptions, toleranceOptions, surfaceTreatmentOptions } from '../constants/materialOptions';
import { StepComponentProps } from '../types';
import { Upload as UploadIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// @ts-expect-error: no types for STLLoader
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
// @ts-expect-error: no types for BufferGeometryUtils
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';
import {
  BufferGeometry,
  Float32BufferAttribute,
  MeshPhongMaterial,
  Color,
  DoubleSide,
  Vector3,
  Box3,
} from 'three';
import { getCatalogMaterials } from '@/utils/catalogApi';
import type { CatalogMaterial } from '@/types/catalog';
import { useTenant } from '@/contexts/TenantContext';

// ── Darker material for embedded viewer ──
const darkCadMaterial = new MeshPhongMaterial({
  color: new Color('#607d8b'),
  specular: new Color('#222222'),
  shininess: 50,
  side: DoubleSide,
});

function smoothGeo(geom: BufferGeometry): BufferGeometry {
  try { const m = mergeVertices(geom); m.computeVertexNormals(); return m; }
  catch { geom.computeVertexNormals(); return geom; }
}

// OCCT loader
let occtP: Promise<any> | null = null;
function loadOcct(): Promise<any> {
  if (!occtP) {
    occtP = new Promise((resolve, reject) => {
      if ((window as any).occtimportjs) { resolve((window as any).occtimportjs()); return; }
      const existing = document.querySelector('script[src="/occt-import-js.js"]');
      if (existing) {
        const c = setInterval(() => { if ((window as any).occtimportjs) { clearInterval(c); resolve((window as any).occtimportjs()); } }, 100);
        setTimeout(() => { clearInterval(c); reject(new Error('timeout')); }, 15000);
        return;
      }
      const s = document.createElement('script');
      s.src = '/occt-import-js.js';
      s.onload = () => {
        const c = setInterval(() => { if ((window as any).occtimportjs) { clearInterval(c); resolve((window as any).occtimportjs()); } }, 100);
        setTimeout(() => { clearInterval(c); reject(new Error('timeout')); }, 15000);
      };
      s.onerror = () => reject(new Error('Failed to load occt'));
      document.head.appendChild(s);
    });
  }
  return occtP;
}

// Inline STL viewer for embedded canvas
function EmbeddedSTL({ url, onDims }: { url: string; onDims: (d: { x: number; y: number; z: number }) => void }) {
  const geometry = useLoader(STLLoader, url) as BufferGeometry;
  const { camera } = useThree();
  const dims = useMemo(() => {
    geometry.computeBoundingBox(); geometry.center();
    const s = new Vector3(); geometry.boundingBox!.getSize(s);
    return { x: s.x, y: s.y, z: s.z };
  }, [geometry]);
  useEffect(() => {
    onDims(dims);
    const max = Math.max(dims.x, dims.y, dims.z);
    const d = max * 1.8;
    camera.position.set(d, d * 0.7, d);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [dims, camera, onDims]);
  return <mesh geometry={geometry} material={darkCadMaterial} />;
}

// Inline STEP viewer for embedded canvas
function EmbeddedSTEP({ url, onDims }: { url: string; onDims: (d: { x: number; y: number; z: number }) => void }) {
  const [geoms, setGeoms] = useState<BufferGeometry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { camera } = useThree();
  const groupRef = useRef<any>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const occt = await loadOcct();
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('fetch fail');
        const buf = await resp.arrayBuffer();
        const res = occt.ReadStepFile(new Uint8Array(buf), { linearDeflection: 0.001, linearDeflectionType: 'bounding_box_ratio' });
        if (!res.success) throw new Error('parse fail');
        if (cancelled) return;
        setGeoms((res.meshes || []).map((m: any) => {
          const g = new BufferGeometry();
          g.setAttribute('position', new Float32BufferAttribute(m.attributes.position.array, 3));
          if (m.index) g.setIndex(Array.from(m.index.array));
          return smoothGeo(g);
        }));
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [url]);
  useEffect(() => {
    if (geoms.length === 0 || !groupRef.current) return;
    const box = new Box3();
    geoms.forEach(g => { g.computeBoundingBox(); if (g.boundingBox) box.union(g.boundingBox); });
    const center = new Vector3(), size = new Vector3();
    box.getCenter(center); box.getSize(size);
    onDims({ x: size.x, y: size.y, z: size.z });
    const max = Math.max(size.x, size.y, size.z);
    const d = max * 1.8;
    camera.position.set(d, d * 0.7, d);
    camera.lookAt(center.x, center.y, center.z);
    camera.updateProjectionMatrix();
  }, [geoms, camera, onDims]);
  if (loading || error || geoms.length === 0) return null;
  return (
    <group ref={groupRef}>
      {geoms.map((g, i) => <mesh key={i} geometry={g} material={darkCadMaterial} />)}
    </group>
  );
}

const isViewableSTL = (n: string) => /\.stl$/i.test(n);
const isViewableSTEP = (n: string) => /\.(step|stp)$/i.test(n);
const isViewableDXF = (n: string) => /\.dxf$/i.test(n);
const isViewableOBJ = (n: string) => /\.obj$/i.test(n);
const isViewable3D = (n: string) => isViewableSTL(n) || isViewableSTEP(n) || isViewableOBJ(n);

// Embedded 3D preview panel - shows first 3D file from the files array
function Embedded3DPreview({ files, onDimensionsChange }: { files: File[]; onDimensionsChange?: (dims: { x: number; y: number; z: number }) => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ x: number; y: number; z: number } | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);

  const first3DFile = useMemo(() => {
    if (!files || files.length === 0) return null;
    return files.find((f: File) => isViewable3D(f.name)) || null;
  }, [files]);

  const firstDxfFile = useMemo(() => {
    if (!files || files.length === 0) return null;
    if (first3DFile) return null;
    return files.find((f: File) => isViewableDXF(f.name)) || null;
  }, [files, first3DFile]);

  useEffect(() => {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    setDims(null);
    if (first3DFile) {
      const url = URL.createObjectURL(first3DFile);
      setBlobUrl(url);
      setPreviewFileName(first3DFile.name);
    } else {
      setBlobUrl(null);
      setPreviewFileName(null);
    }
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first3DFile]);

  useEffect(() => {
    if (dims && onDimensionsChange) onDimensionsChange(dims);
  }, [dims, onDimensionsChange]);

  if (firstDxfFile) {
    return (
      <div className="h-full min-h-[180px] rounded bg-slate-800 border border-slate-600 flex flex-col items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span className="text-xs text-slate-400 mt-1.5 font-medium">2D Drawing</span>
        <span className="text-[10px] text-slate-500 mt-0.5">{firstDxfFile.name}</span>
      </div>
    );
  }

  if (!first3DFile || !blobUrl) {
    return (
      <div className="h-full min-h-[180px] rounded bg-slate-800 border border-slate-600 flex flex-col items-center justify-center">
        <BoxIcon className="h-8 w-8 text-slate-500 mb-1.5" />
        <span className="text-xs text-slate-500">Upload a 3D file to preview</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 rounded overflow-hidden bg-slate-800 border border-slate-600" style={{ minHeight: 180 }}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full w-full">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-500 border-t-slate-300" />
            </div>
          }
        >
          <Canvas
            camera={{ position: [5, 5, 5], fov: 40 }}
            style={{ width: '100%', height: '100%', minHeight: 170 }}
            gl={{ antialias: true, alpha: true }}
          >
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 10, 7]} intensity={1} />
            <directionalLight position={[-5, -3, -5]} intensity={0.3} />
            {previewFileName && isViewableSTL(previewFileName) && (
              <EmbeddedSTL url={blobUrl} onDims={setDims} />
            )}
            {previewFileName && isViewableSTEP(previewFileName) && (
              <EmbeddedSTEP url={blobUrl} onDims={setDims} />
            )}
            {previewFileName && isViewableOBJ(previewFileName) && (
              <EmbeddedSTL url={blobUrl} onDims={setDims} />
            )}
            <OrbitControls enableZoom={true} enablePan={true} />
          </Canvas>
        </Suspense>
      </div>
      {dims && (
        <div className="text-[10px] text-slate-400 text-center py-1">
          {dims.x.toFixed(1)} &times; {dims.y.toFixed(1)} &times; {dims.z.toFixed(1)} mm
        </div>
      )}
    </div>
  );
}

const thicknessOptions = [
  { value: '0.5', label: '0.5 mm' },
  { value: '0.8', label: '0.8 mm' },
  { value: '1', label: '1.0 mm' },
  { value: '1.5', label: '1.5 mm' },
  { value: '2', label: '2.0 mm' },
  { value: '2.5', label: '2.5 mm' },
  { value: '3', label: '3.0 mm' },
  { value: '4', label: '4.0 mm' },
  { value: '5', label: '5.0 mm' },
  { value: '6', label: '6.0 mm' },
  { value: '8', label: '8.0 mm' },
  { value: '10', label: '10.0 mm' },
  { value: '12', label: '12.0 mm' },
  { value: '15', label: '15.0 mm' },
  { value: '20', label: '20.0 mm' },
  { value: '25', label: '25.0 mm' },
];

// ── Material options from database ──
interface DbMaterialOption {
  value: string;
  label: string;
  subtypes: Array<{ value: string; label: string }>;
}

function buildMaterialOptionsFromDb(dbMaterials: CatalogMaterial[]): DbMaterialOption[] {
  // Group by category name; derive subtypes from material_grade
  const catMap = new Map<string, { catName: string; grades: Map<string, string> }>();

  for (const mat of dbMaterials) {
    const catName = mat.category?.name || 'Other';
    const catSlug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!catMap.has(catSlug)) {
      catMap.set(catSlug, { catName, grades: new Map() });
    }
    const entry = catMap.get(catSlug)!;
    if (!entry.grades.has(mat.material_grade)) {
      entry.grades.set(mat.material_grade, `${mat.name} (${mat.material_grade})`);
    }
  }

  const result: DbMaterialOption[] = [];
  for (const [slug, { catName, grades }] of catMap) {
    const subtypes = Array.from(grades.entries()).map(([val, label]) => ({ value: val, label }));
    subtypes.sort((a, b) => a.label.localeCompare(b.label));
    result.push({ value: slug, label: catName, subtypes });
  }
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}

// ── Helper: get subtypes for a given material value ──
function getSubtypesForMaterial(materialValue: string, options: DbMaterialOption[]) {
  return options.find(m => m.value === materialValue)?.subtypes || [];
}

// Map capability keys to quote form process values
const CAPABILITY_TO_PROCESS: Record<string, string> = {
  'cnc_milling': 'cnc-milling',
  'cnc_turning': 'turning',
  'laser_cutting': 'laser-cutting',
  'sheet_metal': 'sheet-metal',
  '3d_printing': '3d-printing',
  'injection_molding': 'injection-molding',
};

const StepPartDetails: React.FC<StepComponentProps> = ({ formikProps }) => {
  const { values, errors, touched, handleChange, setFieldValue } = formikProps;
  const { toast } = useToast();
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set([0]));

  // Determine which processes are enabled for this tenant
  const enabledProcesses = useMemo(() => {
    if (!tenant?.capabilities) return null; // null = show all (no tenant loaded yet)
    return tenant.capabilities
      .filter((c) => c.isEnabled)
      .map((c) => CAPABILITY_TO_PROCESS[c.key])
      .filter(Boolean);
  }, [tenant]);

  // Use static material options (Aluminum, Steel, Stainless Steel, etc.)
  const materialOptions: DbMaterialOption[] = staticMaterialOptions;

  // BUG FIX: No shared materialSubtypes state. Subtypes are derived per-part
  // from the part's own material value using getSubtypesForMaterial()

  const handleMaterialChange = useCallback((partIndex: number, value: string) => {
    setFieldValue(`parts[${partIndex}].material`, value);
    setFieldValue(`parts[${partIndex}].materialSubtype`, '');
  }, [setFieldValue]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, partIndex: number) => {
    if (e.target.files) {
      try {
        const fileList = Array.from(e.target.files);
        const invalidFiles = fileList.filter(file => file.size > 50 * 1024 * 1024);
        if (invalidFiles.length > 0) {
          toast({
            title: t('quote_form_file_size_exceeded'),
            description: `${t('quote_form_file_size_exceeded_desc')} ${invalidFiles.map(f => f.name).join(', ')}`,
            variant: "destructive"
          });
          const validFiles = fileList.filter(file => file.size <= 50 * 1024 * 1024);
          setFieldValue(`parts[${partIndex}].files`, [...values.parts[partIndex].files, ...validFiles]);
        } else {
          setFieldValue(`parts[${partIndex}].files`, [...values.parts[partIndex].files, ...fileList]);
        }
      } catch (error) {
        console.error('Error handling file upload:', error);
        toast({ title: t('quote_form_upload_error'), description: t('quote_form_upload_error_desc'), variant: "destructive" });
      }
    }
  };

  const removeFile = (partIndex: number, fileIndex: number) => {
    const newFiles = [...values.parts[partIndex].files];
    newFiles.splice(fileIndex, 1);
    setFieldValue(`parts[${partIndex}].files`, newFiles);
    if (newFiles.length === 0) {
      setFieldValue(`parts[${partIndex}].name`, `${t('quote_form_part')} ${partIndex + 1}`);
    } else {
      setFieldValue(`parts[${partIndex}].name`, `${t('quote_form_part')} ${partIndex + 1} - ${newFiles[0].name}`);
    }
  };

  const togglePart = (index: number) => {
    setExpandedParts(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const acceptedFileTypes = ".stp,.step,.stl,.obj,.dxf,.pdf,.png,.jpg,.jpeg,.tiff";

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-slate-400" />
          <h3 className="text-base font-semibold text-slate-200">{t('quote_form_parts_configuration_title')}</h3>
        </div>
        <span className="text-xs text-slate-500">
          {values.parts.length} {values.parts.length === 1 ? 'part' : 'parts'}
        </span>
      </div>

      <FieldArray name="parts">
        {({ remove, push }) => (
          <div className="space-y-2">
            {values.parts.length > 0 &&
              values.parts.map((part, index) => {
                const isExpanded = expandedParts.has(index);
                const partSubtypes = getSubtypesForMaterial(part.material, materialOptions);
                const hasError = touched.parts?.[index] && errors.parts?.[index];

                return (
                  <div
                    key={index}
                    className={`rounded-lg border transition-colors ${
                      hasError
                        ? 'border-red-500/40 bg-slate-800/80'
                        : 'border-slate-600/50 bg-slate-800/60'
                    }`}
                  >
                    {/* Part header - always visible */}
                    <button
                      type="button"
                      onClick={() => togglePart(index)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-700/30 transition-colors rounded-t-lg"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex items-center justify-center h-6 w-6 rounded bg-blue-600/20 text-blue-400 text-xs font-bold flex-shrink-0">
                          {index + 1}
                        </span>
                        <span className="text-sm font-medium text-slate-200 truncate">
                          {part.name || `${t('quote_form_part')} ${index + 1}`}
                        </span>
                        {part.quantity > 1 && (
                          <span className="text-[10px] font-medium bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                            x{part.quantity}
                          </span>
                        )}
                        {part.material && part.materialSubtype && (
                          <span className="text-[10px] text-slate-500 hidden sm:inline">
                            {materialOptions.find(m => m.value === part.material)?.label} / {part.materialSubtype}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {values.parts.length > 1 && (
                          <span
                            role="button"
                            onClick={(e) => { e.stopPropagation(); remove(index); }}
                            className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </span>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                    </button>

                    {/* Part content - collapsible */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-700/50">
                        {/* Row 1: Name + Quantity */}
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <div className="col-span-2">
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">
                              {t('quote_form_part_name_id')} <span className="text-red-400">*</span>
                            </Label>
                            <Input
                              id={`parts[${index}].name`}
                              name={`parts[${index}].name`}
                              value={part.name}
                              readOnly
                              className={`h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-300 ${
                                touched.parts?.[index]?.name && errors.parts?.[index]?.name ? 'border-red-500' : ''
                              }`}
                            />
                          </div>
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">
                              {t('quote_form_quantity')} <span className="text-red-400">*</span>
                            </Label>
                            <Input
                              id={`parts[${index}].quantity`}
                              name={`parts[${index}].quantity`}
                              type="number"
                              min="1"
                              value={part.quantity}
                              onChange={handleChange}
                              className={`h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200 ${
                                touched.parts?.[index]?.quantity && errors.parts?.[index]?.quantity ? 'border-red-500' : ''
                              }`}
                            />
                          </div>
                        </div>

                        {/* Row 2: Process */}
                        <div className="mb-2">
                          <Label className="text-[11px] text-slate-400 mb-0.5 block">
                            {t('quote_form_manufacturing_process')} <span className="text-red-400">*</span>
                          </Label>
                          <Select
                            value={part.process}
                            onValueChange={(value) => setFieldValue(`parts[${index}].process`, value)}
                          >
                            <SelectTrigger className={`h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200 ${
                              touched.parts?.[index]?.process && errors.parts?.[index]?.process ? 'border-red-500' : ''
                            }`}>
                              <SelectValue placeholder={t('quote_form_select_manufacturing_process')} />
                            </SelectTrigger>
                            <SelectContent>
                              {(!enabledProcesses || enabledProcesses.includes('cnc-milling')) && (
                                <SelectItem value="cnc-milling">{t('quote_form_cnc_milling')}</SelectItem>
                              )}
                              {(!enabledProcesses || enabledProcesses.includes('turning')) && (
                                <SelectItem value="turning">{t('quote_form_turning')}</SelectItem>
                              )}
                              {(!enabledProcesses || enabledProcesses.includes('laser-cutting')) && (
                                <SelectItem value="laser-cutting">{t('quote_form_laser_cutting')}</SelectItem>
                              )}
                              {(!enabledProcesses || enabledProcesses.includes('sheet-metal')) && (
                                <SelectItem value="sheet-metal">{t('quote_form_sheet_metal')}</SelectItem>
                              )}
                              {(!enabledProcesses || enabledProcesses.includes('3d-printing')) && (
                                <SelectItem value="3d-printing">{t('quote_form_3d_printing')}</SelectItem>
                              )}
                              {(!enabledProcesses || enabledProcesses.includes('injection-molding')) && (
                                <SelectItem value="injection-molding">{t('quote_form_injection_molding')}</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          {touched.parts?.[index]?.process && errors.parts?.[index]?.process && (
                            <p className="text-red-400 text-[10px] mt-0.5">{String(errors.parts?.[index]?.process || '')}</p>
                          )}
                        </div>

                        {/* Row 3: Material + Grade (FIX: per-part subtypes) */}
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">
                              {t('quote_form_material')} <span className="text-red-400">*</span>
                            </Label>
                            <Select
                              value={part.material}
                              onValueChange={(value) => handleMaterialChange(index, value)}
                            >
                              <SelectTrigger className={`h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200 ${
                                touched.parts?.[index]?.material && errors.parts?.[index]?.material ? 'border-red-500' : ''
                              }`}>
                                <SelectValue placeholder={t('quote_form_select_material')} />
                              </SelectTrigger>
                              <SelectContent>
                                {materialOptions.map((material) => (
                                  <SelectItem key={material.value} value={material.value}>
                                    {material.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {touched.parts?.[index]?.material && errors.parts?.[index]?.material && (
                              <p className="text-red-400 text-[10px] mt-0.5">{String(errors.parts?.[index]?.material || '')}</p>
                            )}
                          </div>
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">
                              {t('quote_form_material_grade')} <span className="text-red-400">*</span>
                            </Label>
                            <Select
                              value={part.materialSubtype}
                              onValueChange={(value) => setFieldValue(`parts[${index}].materialSubtype`, value)}
                              disabled={!part.material}
                            >
                              <SelectTrigger className={`h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200 ${
                                touched.parts?.[index]?.materialSubtype && errors.parts?.[index]?.materialSubtype ? 'border-red-500' : ''
                              }`}>
                                <SelectValue placeholder={t('quote_form_select_material_grade')} />
                              </SelectTrigger>
                              <SelectContent>
                                {partSubtypes.map((subtype) => (
                                  <SelectItem key={subtype.value} value={subtype.value}>
                                    {subtype.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {touched.parts?.[index]?.materialSubtype && errors.parts?.[index]?.materialSubtype && (
                              <p className="text-red-400 text-[10px] mt-0.5">{String(errors.parts?.[index]?.materialSubtype)}</p>
                            )}
                          </div>
                        </div>

                        {/* Row 4: Surface Roughness + Treatment */}
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">{t('quote_form_surface_roughness')}</Label>
                            <Select
                              value={part.surfaceRoughness}
                              onValueChange={(value) => setFieldValue(`parts[${index}].surfaceRoughness`, value)}
                            >
                              <SelectTrigger className="h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200">
                                <SelectValue placeholder={t('quote_form_select_surface_roughness')} />
                              </SelectTrigger>
                              <SelectContent>
                                {surfaceRoughnessOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">{t('quote_form_surface_treatment')}</Label>
                            <Select
                              value={part.surfaceTreatment}
                              onValueChange={(value) => setFieldValue(`parts[${index}].surfaceTreatment`, value)}
                            >
                              <SelectTrigger className="h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200">
                                <SelectValue placeholder={t('quote_form_select_surface_treatment')} />
                              </SelectTrigger>
                              <SelectContent>
                                {surfaceTreatmentOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Row 5: Tolerance + Documentation */}
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">{t('quote_form_tolerance')}</Label>
                            <Select
                              value={part.tolerance}
                              onValueChange={(value) => setFieldValue(`parts[${index}].tolerance`, value)}
                            >
                              <SelectTrigger className="h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200">
                                <SelectValue placeholder={t('quote_form_select_tolerance')} />
                              </SelectTrigger>
                              <SelectContent>
                                {toleranceOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">{t('quote_form_documentation')}</Label>
                            <Select
                              value={part.documentation}
                              onValueChange={(value) => setFieldValue(`parts[${index}].documentation`, value)}
                            >
                              <SelectTrigger className="h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200">
                                <SelectValue placeholder={t('quote_form_select_documentation')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">{t('quote_form_none')}</SelectItem>
                                <SelectItem value="basic">{t('quote_form_basic')}</SelectItem>
                                <SelectItem value="detailed">{t('quote_form_detailed')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Row 6: Thickness + Bending */}
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">
                              Material Thickness (mm)
                              {['laser-cutting', 'sheet-metal', 'plasma-cutting'].includes(part.process) && (
                                <span className="text-red-400"> *</span>
                              )}
                            </Label>
                            <Input
                              id={`parts[${index}].thickness`}
                              name={`parts[${index}].thickness`}
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={part.thickness || ''}
                              onChange={handleChange}
                              placeholder="e.g. 2.5"
                              className={`h-8 text-sm bg-slate-900/50 border-slate-600 text-slate-200 ${
                                touched.parts?.[index]?.thickness && errors.parts?.[index]?.thickness ? 'border-red-500' : ''
                              }`}
                            />
                            {touched.parts?.[index]?.thickness && errors.parts?.[index]?.thickness && (
                              <p className="text-red-400 text-[10px] mt-0.5">{String(errors.parts?.[index]?.thickness)}</p>
                            )}
                          </div>
                          <div className="flex items-end pb-1">
                            <div className="flex items-center gap-1.5">
                              <Checkbox
                                id={`parts[${index}].needsBending`}
                                checked={part.needsBending || false}
                                onCheckedChange={(checked) => setFieldValue(`parts[${index}].needsBending`, !!checked)}
                                className="border-slate-500 data-[state=checked]:bg-blue-600"
                              />
                              <Label htmlFor={`parts[${index}].needsBending`} className="text-xs text-slate-400 font-normal cursor-pointer">
                                Requires bending
                              </Label>
                            </div>
                          </div>
                        </div>

                        {/* Comments */}
                        <div className="mb-3">
                          <Label className="text-[11px] text-slate-400 mb-0.5 block">{t('quote_form_comments')}</Label>
                          <Textarea
                            id={`parts[${index}].comments`}
                            name={`parts[${index}].comments`}
                            value={part.comments}
                            onChange={handleChange}
                            placeholder="Additional specifications or requirements..."
                            rows={2}
                            className="text-sm bg-slate-900/50 border-slate-600 text-slate-200 placeholder:text-slate-600 resize-none"
                          />
                        </div>

                        {/* Upload + 3D Preview */}
                        <div>
                          <Label className="text-[11px] text-slate-400 mb-1 block">
                            {t('quote_form_upload_files')} <span className="text-red-400">*</span>
                          </Label>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {/* Upload area */}
                            <div>
                              <div className="border border-dashed border-slate-600 rounded bg-slate-900/40 p-3 text-center">
                                <UploadIcon className="mx-auto h-6 w-6 text-slate-500" />
                                <p className="text-xs text-slate-500 mt-1">{t('quote_form_drag_drop_files')}</p>
                                <p className="text-[10px] text-slate-600 mt-0.5">{t('quote_form_accepted_file_types')}</p>
                                <input
                                  type="file"
                                  multiple
                                  accept={acceptedFileTypes}
                                  onChange={(e) => handleFileChange(e, index)}
                                  className="hidden"
                                  id={`file-upload-${index}`}
                                />
                                <label
                                  htmlFor={`file-upload-${index}`}
                                  className="mt-2 inline-flex items-center px-3 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer transition-colors"
                                >
                                  {t('quote_form_upload_files')}
                                </label>
                              </div>
                              {/* File list */}
                              {part.files && part.files.length > 0 && (
                                <div className="mt-1.5 space-y-1">
                                  {part.files.map((file: any, fileIndex: number) => (
                                    <div key={fileIndex} className="flex items-center justify-between px-2 py-1 bg-slate-900/60 border border-slate-700/50 rounded text-xs">
                                      <div className="flex items-center min-w-0 gap-1">
                                        <FileText className="h-3 w-3 text-slate-500 flex-shrink-0" />
                                        <span className="truncate text-slate-300">{file.name}</span>
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeFile(index, fileIndex)}
                                        className="h-4 w-4 p-0 flex-shrink-0 text-slate-500 hover:text-red-400"
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* 3D Preview */}
                            <div>
                              <Embedded3DPreview
                                files={part.files || []}
                                onDimensionsChange={(dims) => {
                                  if (!values.parts[index]._dimensions ||
                                      values.parts[index]._dimensions?.x !== dims.x ||
                                      values.parts[index]._dimensions?.y !== dims.y ||
                                      values.parts[index]._dimensions?.z !== dims.z) {
                                    setFieldValue(`parts.${index}._dimensions`, dims);
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Add Part button */}
            <button
              type="button"
              onClick={() => {
                push({
                  name: `${t('quote_form_part')} ${values.parts.length + 1}`,
                  quantity: 1,
                  multiplier: 1,
                  files: [],
                  process: '',
                  material: '',
                  materialSubtype: '',
                  surfaceTreatment: '',
                  surfaceRoughness: '',
                  documentation: 'none',
                  comments: '',
                  userModifiedName: false,
                  tolerance: '',
                  surfaceTreatmentOther: '',
                  thickness: '',
                  needsBending: false,
                });
                setTimeout(() => {
                  setExpandedParts(prev => new Set([...prev, values.parts.length]));
                }, 50);
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors text-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('quote_form_add_part')}
            </button>
          </div>
        )}
      </FieldArray>
    </div>
  );
};

export default StepPartDetails;
