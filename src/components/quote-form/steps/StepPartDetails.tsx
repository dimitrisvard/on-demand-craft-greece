import React, { useState } from 'react';
import { FormikProps, FieldArray } from 'formik';
import { Plus, Trash2, FileText, X, MoreHorizontal, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
                      <AccordionTrigger className="px-6 py-4 bg-gray-50 hover:bg-gray-100 hover:no-underline">
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

                        <div className="mb-6">
                          <Label className="block mb-2">
                            {t('quote_form_upload_files')} <span className="text-red-500">*</span>
                          </Label>
                          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                            <UploadIcon className="mx-auto h-12 w-12 text-gray-400" />
                            <div className="mt-4">
                              <p className="text-sm text-gray-600">{t('quote_form_drag_drop_files')}</p>
                              <p className="text-xs text-gray-500 mt-1">{t('quote_form_accepted_file_types')}</p>
                              <p className="text-xs text-gray-500">{t('quote_form_file_size_limit')}</p>
                            </div>
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
                              className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 cursor-pointer"
                            >
                              {t('quote_form_upload_files')}
                            </label>
                          </div>
                          
                          {part.files && part.files.length > 0 && (
                            <div className="mt-4">
                              <h4 className="text-sm font-medium mb-2">{t('quote_form_files_uploaded')}:</h4>
                              <div className="space-y-2">
                                {part.files.map((file: any, fileIndex: number) => (
                                  <div key={fileIndex} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                    <div className="flex items-center">
                                      <FileText className="h-4 w-4 text-gray-500 mr-2" />
                                      <span className="text-sm">{file.name}</span>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeFile(index, fileIndex)}
                                      className="h-6 w-6 p-0"
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
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
                onClick={() => push({
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
                })}
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
