import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { FormikProps, FieldArray } from 'formik';
import { Plus, Trash2, FileText, X, Box as BoxIcon } from 'lucide-react';
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
import { materialOptions, surfaceRoughnessOptions, toleranceOptions, surfaceTreatmentOptions } from '../constants/materialOptions';
import { StepComponentProps } from '../types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
function Embedded3DPreview({ files }: { files: File[] }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ x: number; y: number; z: number } | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);

  // Find the first viewable 3D file (STL, STEP/STP, OBJ -- NOT DXF)
  const first3DFile = useMemo(() => {
    if (!files || files.length === 0) return null;
    return files.find((f: File) => isViewable3D(f.name)) || null;
  }, [files]);

  // Check if there's only a DXF (no viewable 3D file)
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

  // No 3D file but there is a DXF
  if (firstDxfFile) {
    return (
      <div className="h-full min-h-[200px] rounded-lg bg-slate-100 border border-slate-200 flex flex-col items-center justify-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span className="text-sm text-slate-500 mt-2 font-medium">2D Drawing</span>
        <span className="text-xs text-slate-400 mt-1">{firstDxfFile.name}</span>
      </div>
    );
  }

  // No file at all
  if (!first3DFile || !blobUrl) {
    return (
      <div className="h-full min-h-[200px] rounded-lg bg-slate-100 border border-slate-200 flex flex-col items-center justify-center">
        <BoxIcon className="h-10 w-10 text-slate-300 mb-2" />
        <span className="text-sm text-slate-400">Upload a 3D file to preview</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 rounded-lg overflow-hidden bg-slate-100 border border-teal-300" style={{ minHeight: 200 }}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full w-full">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-300 border-t-slate-600" />
            </div>
          }
        >
          <Canvas
            camera={{ position: [5, 5, 5], fov: 40 }}
            style={{ width: '100%', height: '100%', minHeight: 180 }}
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
        <div className="text-xs text-slate-500 text-center py-1.5">
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

const is3DFile = (name: string) => /\.(stl|obj|glb|gltf|step|stp|dxf)$/i.test(name);

const StepPartDetails: React.FC<StepComponentProps> = ({ formikProps }) => {
  const { values, errors, touched, handleChange, setFieldValue } = formikProps;
  const { toast } = useToast();
  const { t } = useTranslation();
  const [materialSubtypes, setMaterialSubtypes] = useState<any[]>([]);
  const [expandedAccordions, setExpandedAccordions] = useState<string[]>(['part-0']);

  const handleMaterialChange = (partIndex: number, value: string) => {
    const selectedMaterial = materialOptions.find((m) => m.value === value);
    setMaterialSubtypes(selectedMaterial?.subtypes || []);
    setFieldValue(`parts[${partIndex}].material`, value);
    setFieldValue(`parts[${partIndex}].materialSubtype`, '');
  };

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
        toast({
          title: t('quote_form_upload_error'),
          description: t('quote_form_upload_error_desc'),
          variant: "destructive"
        });
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

  const acceptedFileTypes = ".stp,.step,.stl,.obj,.dxf,.pdf,.png,.jpg,.jpeg,.tiff";

  return (
    <div className="space-y-8">
      <h3 className="text-xl font-medium mb-6">{t('quote_form_parts_configuration_title')}</h3>

      <FieldArray name="parts">
        {({ remove, push }) => (
          <div className="space-y-4">
            {values.parts.length > 0 &&
              values.parts.map((part, index) => (
                <div key={index}>
                  <Accordion
                    type="single"
                    collapsible
                    value={expandedAccordions.includes(`part-${index}`) ? `part-${index}` : ''}
                    onValueChange={(value) => setExpandedAccordions((prev) =>
                      value ? [...prev, `part-${index}`] : prev.filter(item => item !== `part-${index}`)
                    )}
                    className="border rounded-lg overflow-hidden"
                  >
                    <AccordionItem value={`part-${index}`} className="border-0">
                      <AccordionTrigger 
                        className="px-6 py-4 bg-gray-50 hover:bg-gray-100 hover:no-underline"
                        data-part-index={index}
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center">
                            <span className="text-lg font-medium">
                              {part.name || `${t('quote_form_part')} ${index + 1}`}
                            </span>
                            {part.quantity > 1 && (
                              <span className="ml-2 text-sm text-gray-500">
                                × {part.quantity}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            {values.parts.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  remove(index);
                                }}
                              >
                                <span className="sr-only">{t('quote_form_remove_part')}</span>
                                <Trash2 size={16} />
                              </Button>
                            )}
                          </div>
                        </div>
                      </AccordionTrigger>

                      <AccordionContent className="px-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                          <div>
                            <Label htmlFor={`parts[${index}].name`}>
                              {t('quote_form_part_name_id')} <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id={`parts[${index}].name`}
                              name={`parts[${index}].name`}
                              value={part.name}
                              readOnly
                              className={
                                touched.parts?.[index]?.name && errors.parts?.[index]?.name
                                  ? 'border-red-500 bg-gray-100'
                                  : 'bg-gray-100'
                              }
                            />
                            {touched.parts?.[index]?.name && errors.parts?.[index]?.name && (
                              <p className="text-red-500 text-sm mt-1">{String(errors.parts?.[index]?.name || '')}</p>
                            )}
                          </div>

                          <div>
                            <Label htmlFor={`parts[${index}].quantity`}>
                              {t('quote_form_quantity')} <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id={`parts[${index}].quantity`}
                              name={`parts[${index}].quantity`}
                              type="number"
                              min="1"
                              value={part.quantity}
                              onChange={handleChange}
                              className={
                                touched.parts?.[index]?.quantity && errors.parts?.[index]?.quantity
                                  ? 'border-red-500'
                                  : ''
                              }
                            />
                            {touched.parts?.[index]?.quantity && errors.parts?.[index]?.quantity && (
                              <p className="text-red-500 text-sm mt-1">{String(errors.parts?.[index]?.quantity || '')}</p>
                            )}
                          </div>
                        </div>

                        <div className="mb-6">
                          <Label htmlFor={`parts[${index}].process`}>
                            {t('quote_form_manufacturing_process')} <span className="text-red-500">*</span>
                          </Label>
                          <Select
                            value={part.process}
                            onValueChange={(value) =>
                              setFieldValue(`parts[${index}].process`, value)
                            }
                          >
                            <SelectTrigger
                              className={
                                touched.parts?.[index]?.process && errors.parts?.[index]?.process
                                  ? 'border-red-500'
                                  : ''
                              }
                            >
                              <SelectValue placeholder={t('quote_form_select_manufacturing_process')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cnc-milling">{t('quote_form_cnc_milling')}</SelectItem>
                              <SelectItem value="turning">{t('quote_form_turning')}</SelectItem>
                              <SelectItem value="laser-cutting">{t('quote_form_laser_cutting')}</SelectItem>
                              <SelectItem value="sheet-metal">{t('quote_form_sheet_metal')}</SelectItem>
                              <SelectItem value="3d-printing">{t('quote_form_3d_printing')}</SelectItem>
                              <SelectItem value="injection-molding">{t('quote_form_injection_molding')}</SelectItem>
                            </SelectContent>
                          </Select>
                          {touched.parts?.[index]?.process && errors.parts?.[index]?.process && (
                            <p className="text-red-500 text-sm mt-1">{String(errors.parts?.[index]?.process || '')}</p>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                          <div>
                            <Label htmlFor={`parts[${index}].material`}>
                              {t('quote_form_material')} <span className="text-red-500">*</span>
                            </Label>
                            <Select
                              value={part.material}
                              onValueChange={(value) => handleMaterialChange(index, value)}
                            >
                              <SelectTrigger
                                className={
                                  touched.parts?.[index]?.material && errors.parts?.[index]?.material
                                    ? 'border-red-500'
                                    : ''
                                }
                              >
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
                              <p className="text-red-500 text-sm mt-1">{String(errors.parts?.[index]?.material || '')}</p>
                            )}
                          </div>

                          <div>
                            <Label htmlFor={`parts[${index}].materialSubtype`}>
                              {t('quote_form_material_grade')} <span className="text-red-500">*</span>
                            </Label>
                            <Select
                              value={part.materialSubtype}
                              onValueChange={(value) =>
                                setFieldValue(`parts[${index}].materialSubtype`, value)
                              }
                              disabled={!part.material}
                            >
                              <SelectTrigger
                                className={
                                  touched.parts?.[index]?.materialSubtype && errors.parts?.[index]?.materialSubtype
                                    ? 'border-red-500'
                                    : ''
                                }
                              >
                                <SelectValue placeholder={t('quote_form_select_material_grade')} />
                              </SelectTrigger>
                              <SelectContent>
                                {materialSubtypes.map((subtype) => (
                                  <SelectItem key={subtype.value} value={subtype.value}>
                                    {subtype.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {touched.parts?.[index]?.materialSubtype && errors.parts?.[index]?.materialSubtype && (
                              <p className="text-red-500 text-sm mt-1">{String(errors.parts?.[index]?.materialSubtype)}</p>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                          <div>
                            <Label htmlFor={`parts[${index}].surfaceRoughness`}>
                              {t('quote_form_surface_roughness')}
                            </Label>
                            <Select
                              value={part.surfaceRoughness}
                              onValueChange={(value) =>
                                setFieldValue(`parts[${index}].surfaceRoughness`, value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t('quote_form_select_surface_roughness')} />
                              </SelectTrigger>
                              <SelectContent>
                                {surfaceRoughnessOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label htmlFor={`parts[${index}].surfaceTreatment`}>
                              {t('quote_form_surface_treatment')}
                            </Label>
                            <Select
                              value={part.surfaceTreatment}
                              onValueChange={(value) =>
                                setFieldValue(`parts[${index}].surfaceTreatment`, value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t('quote_form_select_surface_treatment')} />
                              </SelectTrigger>
                              <SelectContent>
                                {surfaceTreatmentOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                          <div>
                            <Label htmlFor={`parts[${index}].tolerance`}>
                              {t('quote_form_tolerance')}
                            </Label>
                            <Select
                              value={part.tolerance}
                              onValueChange={(value) =>
                                setFieldValue(`parts[${index}].tolerance`, value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t('quote_form_select_tolerance')} />
                              </SelectTrigger>
                              <SelectContent>
                                {toleranceOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label htmlFor={`parts[${index}].documentation`}>
                              {t('quote_form_documentation')}
                            </Label>
                            <Select
                              value={part.documentation}
                              onValueChange={(value) =>
                                setFieldValue(`parts[${index}].documentation`, value)
                              }
                            >
                              <SelectTrigger>
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

                        {/* Thickness & Bending */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                          <div>
                            <Label htmlFor={`parts[${index}].thickness`}>
                              Material Thickness
                            </Label>
                            <Select
                              value={part.thickness || ''}
                              onValueChange={(value) =>
                                setFieldValue(`parts[${index}].thickness`, value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select thickness" />
                              </SelectTrigger>
                              <SelectContent>
                                {thicknessOptions.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex items-end pb-2">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`parts[${index}].needsBending`}
                                checked={part.needsBending || false}
                                onCheckedChange={(checked) =>
                                  setFieldValue(`parts[${index}].needsBending`, !!checked)
                                }
                              />
                              <Label
                                htmlFor={`parts[${index}].needsBending`}
                                className="text-sm font-normal cursor-pointer"
                              >
                                This part requires bending
                              </Label>
                            </div>
                          </div>
                        </div>

                        <div className="mb-6">
                          <Label htmlFor={`parts[${index}].comments`}>
                            {t('quote_form_comments')}
                          </Label>
                          <Textarea
                            id={`parts[${index}].comments`}
                            name={`parts[${index}].comments`}
                            value={part.comments}
                            onChange={handleChange}
                            placeholder="Any additional specifications or requirements..."
                            rows={3}
                          />
                        </div>

                        {/* Upload + 3D Preview side by side */}
                        <div className="mb-6">
                          <Label className="block mb-2">
                            {t('quote_form_upload_files')} <span className="text-red-500">*</span>
                          </Label>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Left: Upload area */}
                            <div>
                              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                                <UploadIcon className="mx-auto h-8 w-8 text-gray-400" />
                                <p className="text-sm text-gray-600 mt-2">{t('quote_form_drag_drop_files')}</p>
                                <p className="text-[11px] text-gray-400 mt-1">{t('quote_form_accepted_file_types')}</p>
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
                                  className="mt-3 inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700 cursor-pointer"
                                >
                                  {t('quote_form_upload_files')}
                                </label>
                              </div>
                              {/* File list */}
                              {part.files && part.files.length > 0 && (
                                <div className="mt-3 space-y-1.5">
                                  {part.files.map((file: any, fileIndex: number) => (
                                    <div key={fileIndex} className="flex items-center justify-between p-1.5 bg-gray-50 rounded text-sm">
                                      <div className="flex items-center min-w-0">
                                        <FileText className="h-3.5 w-3.5 text-gray-400 mr-1.5 flex-shrink-0" />
                                        <span className="truncate text-xs">{file.name}</span>
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeFile(index, fileIndex)}
                                        className="h-5 w-5 p-0 flex-shrink-0"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Right: Embedded 3D Preview */}
                            <div>
                              <Embedded3DPreview
                                files={part.files || []}
                              />
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              ))}

            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const newPartIndex = values.parts.length;
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
                  // Auto-open the new part accordion
                  setTimeout(() => {
                    const accordionTrigger = document.querySelector(`[data-part-index="${newPartIndex}"]`);
                    if (accordionTrigger) {
                      (accordionTrigger as HTMLElement).click();
                    }
                  }, 100);
                }}
                className="flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('quote_form_add_part')}
              </Button>
            </div>
          </div>
        )}
      </FieldArray>

      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              {t('quote_form_add_parts_description')}
            </p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default StepPartDetails;
