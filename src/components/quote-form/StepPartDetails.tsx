
import React, { useState } from 'react';
import { FieldArray, FormikProps } from 'formik';
import { Box, Plus, Trash2, Copy, Edit, Eye, X, Check, AlertTriangle, CloudUpload } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';

interface StepPartDetailsProps {
  formikProps: FormikProps<any>;
}

const materialOptions = {
  'aluminum': ['6061', '7075', '5052', '2024', 'A356', 'A380'],
  'steel': ['1018', '1045', '4140', 'A36', 'P20'],
  'stainless-steel': ['304', '316', '316L', '410', '17-4 PH'],
  'plastic': ['ABS', 'PLA', 'Nylon', 'PEEK', 'POM/Delrin', 'HDPE', 'Polycarbonate', 'TPU'],
  'brass': ['C360', 'C464', 'C260', 'C280'],
  'copper': ['C101', 'C110', 'C145'],
  'titanium': ['Grade 2', 'Grade 5 (Ti-6Al-4V)', 'Grade 9'],
  'other': ['Please specify in notes']
};

const StepPartDetails: React.FC<StepPartDetailsProps> = ({ formikProps }) => {
  const { values, errors, touched, setFieldValue } = formikProps;
  const [currentEditingPart, setCurrentEditingPart] = useState<number | null>(null);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [previewFile, setPreviewFile] = useState<{file: File, url: string} | null>(null);

  const handleFileUploadForPart = (partIndex: number, files: FileList) => {
    if (files && files.length > 0) {
      const newFiles = Array.from(files);
      
      // Only allow replacing files for a part
      setFieldValue(`parts[${partIndex}].files`, newFiles);
    }
  };

  const removePartFile = (partIndex: number, fileIndex: number) => {
    const updatedFiles = [...values.parts[partIndex].files];
    updatedFiles.splice(fileIndex, 1);
    setFieldValue(`parts[${partIndex}].files`, updatedFiles);
  };

  const handleQuantityChange = (index: number, action: 'increase' | 'decrease') => {
    const currentValue = values.parts[index].quantity;
    const newValue = action === 'increase' ? currentValue + 1 : Math.max(1, currentValue - 1);
    setFieldValue(`parts[${index}].quantity`, newValue);
  };

  const handleMultiplierChange = (index: number, action: 'increase' | 'decrease') => {
    const currentValue = values.parts[index].multiplier;
    const newValue = action === 'increase' ? currentValue + 1 : Math.max(1, currentValue - 1);
    setFieldValue(`parts[${index}].multiplier`, newValue);
  };

  const handlePreviewFile = (file: File) => {
    if (['png', 'jpg', 'jpeg', 'tiff', 'tif'].includes(file.name.split('.').pop()?.toLowerCase() || '')) {
      const url = URL.createObjectURL(file);
      setPreviewFile({ file, url });
    } else {
      setPreviewFile({ file, url: '' });
    }
  };

  // Function to associate files from step 2 with a part
  const associateFileWithPart = (partIndex: number, file: File) => {
    const currentPartFiles = values.parts[partIndex].files || [];
    setFieldValue(`parts[${partIndex}].files`, [...currentPartFiles, file]);
    
    // Remove from main files array
    const mainFilesUpdated = values.files.filter((f: File) => f !== file);
    setFieldValue('files', mainFilesUpdated);
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-medium">Parts Overview</h3>
        {values.parts.length > 1 && (
          <span className="text-sm text-gray-500">
            Total Parts: {values.parts.length}
          </span>
        )}
      </div>

      <FieldArray
        name="parts"
        render={arrayHelpers => (
          <div className="space-y-6">
            {values.parts.map((part: any, index: number) => {
              const partErrors = errors.parts?.[index] as any;
              const partTouched = touched.parts?.[index] as any;
              
              return (
                <div key={index} className="border rounded-lg p-5 bg-white shadow-sm">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center">
                      <Box className="text-teal-600 mr-2" size={20} />
                      <div>
                        <h4 className="text-lg font-medium">
                          Part {index + 1}
                          {part.files && part.files.length > 0 && (
                            <span className="ml-2 text-sm text-gray-500">
                              - {part.files[0].name}
                            </span>
                          )}
                        </h4>
                        {part.process && part.material && (
                          <p className="text-sm text-gray-500">
                            {part.process.replace('-', ' ')} / {part.material} {part.materialSubtype && `/ ${part.materialSubtype}`}
                          </p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex space-x-2">
                      {/* Part file preview button */}
                      {part.files && part.files.length > 0 && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-gray-500 hover:text-teal-600"
                              onClick={() => handlePreviewFile(part.files[0])}
                            >
                              <Eye size={18} />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl p-6">
                            <h3 className="text-lg font-medium mb-4">File Preview: {previewFile?.file.name}</h3>
                            {previewFile && previewFile.url ? (
                              <div className="flex justify-center">
                                <img 
                                  src={previewFile.url} 
                                  alt={previewFile.file.name} 
                                  className="max-h-96 object-contain"
                                  onLoad={() => URL.revokeObjectURL(previewFile.url)}
                                />
                              </div>
                            ) : (
                              <div className="bg-gray-100 p-8 text-center rounded">
                                <p className="text-gray-600">Preview not available for {previewFile?.file.name.split('.').pop()?.toUpperCase()} files</p>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>
                      )}
                      
                      {/* Upload file for this part */}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-gray-500 hover:text-teal-600"
                        onClick={() => {
                          setCurrentEditingPart(index);
                          setShowFileUpload(true);
                        }}
                      >
                        <Edit size={18} />
                      </Button>
                      
                      {/* Duplicate part button */}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-gray-500 hover:text-teal-600"
                        onClick={() => arrayHelpers.push({...part, name: `Part ${values.parts.length + 1}`, files: []})}
                      >
                        <Copy size={18} />
                      </Button>
                      
                      {/* Remove part button (disabled if only one part) */}
                      {values.parts.length > 1 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-gray-500 hover:text-red-500"
                          onClick={() => arrayHelpers.remove(index)}
                        >
                          <Trash2 size={18} />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <Label htmlFor={`parts[${index}].name`}>
                        Part Name/ID <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id={`parts[${index}].name`}
                        name={`parts[${index}].name`}
                        value={part.name}
                        onChange={formikProps.handleChange}
                        onBlur={formikProps.handleBlur}
                        className={partTouched?.name && partErrors?.name ? 'border-red-500' : ''}
                      />
                      {partTouched?.name && partErrors?.name && (
                        <p className="text-red-500 text-sm mt-1">{partErrors.name}</p>
                      )}
                    </div>
                    
                    <div>
                      <Label htmlFor={`parts[${index}].process`}>
                        Manufacturing Process <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        name={`parts[${index}].process`}
                        value={part.process}
                        onValueChange={(value) => setFieldValue(`parts[${index}].process`, value)}
                      >
                        <SelectTrigger className={partTouched?.process && partErrors?.process ? 'border-red-500' : ''}>
                          <SelectValue placeholder="Select a process" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cnc-machining">CNC Machining</SelectItem>
                          <SelectItem value="sheet-metal">Sheet Metal Processing</SelectItem>
                          <SelectItem value="3d-printing">3D Printing</SelectItem>
                          <SelectItem value="injection-molding">Injection Molding</SelectItem>
                          <SelectItem value="casting">Casting</SelectItem>
                          <SelectItem value="forming">Forming</SelectItem>
                          <SelectItem value="other">Other Process</SelectItem>
                        </SelectContent>
                      </Select>
                      {partTouched?.process && partErrors?.process && (
                        <p className="text-red-500 text-sm mt-1">{partErrors.process}</p>
                      )}
                    </div>
                    
                    <div>
                      <Label htmlFor={`parts[${index}].material`}>
                        Material <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        name={`parts[${index}].material`}
                        value={part.material}
                        onValueChange={(value) => {
                          setFieldValue(`parts[${index}].material`, value);
                          setFieldValue(`parts[${index}].materialSubtype`, '');
                        }}
                      >
                        <SelectTrigger className={partTouched?.material && partErrors?.material ? 'border-red-500' : ''}>
                          <SelectValue placeholder="Select a material" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="aluminum">Aluminum Alloys</SelectItem>
                          <SelectItem value="steel">Steel</SelectItem>
                          <SelectItem value="stainless-steel">Stainless Steel</SelectItem>
                          <SelectItem value="plastic">Plastic</SelectItem>
                          <SelectItem value="brass">Brass</SelectItem>
                          <SelectItem value="copper">Copper</SelectItem>
                          <SelectItem value="titanium">Titanium</SelectItem>
                          <SelectItem value="other">Other Material</SelectItem>
                        </SelectContent>
                      </Select>
                      {partTouched?.material && partErrors?.material && (
                        <p className="text-red-500 text-sm mt-1">{partErrors.material}</p>
                      )}
                    </div>
                    
                    {part.material && part.material !== '' && part.material !== 'other' && (
                      <div>
                        <Label htmlFor={`parts[${index}].materialSubtype`}>
                          Material Type <span className="text-red-500">*</span>
                        </Label>
                        <Select
                          name={`parts[${index}].materialSubtype`}
                          value={part.materialSubtype}
                          onValueChange={(value) => setFieldValue(`parts[${index}].materialSubtype`, value)}
                        >
                          <SelectTrigger className={partTouched?.materialSubtype && partErrors?.materialSubtype ? 'border-red-500' : ''}>
                            <SelectValue placeholder="Select material type" />
                          </SelectTrigger>
                          <SelectContent>
                            {materialOptions[part.material as keyof typeof materialOptions]?.map((option) => (
                              <SelectItem key={option} value={option}>{option}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {partTouched?.materialSubtype && partErrors?.materialSubtype && (
                          <p className="text-red-500 text-sm mt-1">{partErrors.materialSubtype}</p>
                        )}
                      </div>
                    )}
                    
                    <div>
                      <Label htmlFor={`parts[${index}].quantity`}>
                        Quantity <span className="text-red-500">*</span>
                      </Label>
                      <div className="flex">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-r-none"
                          onClick={() => handleQuantityChange(index, 'decrease')}
                          disabled={part.quantity <= 1}
                        >
                          -
                        </Button>
                        <Input
                          id={`parts[${index}].quantity`}
                          name={`parts[${index}].quantity`}
                          type="number"
                          min="1"
                          value={part.quantity}
                          onChange={formikProps.handleChange}
                          onBlur={formikProps.handleBlur}
                          className="rounded-none text-center"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-l-none"
                          onClick={() => handleQuantityChange(index, 'increase')}
                        >
                          +
                        </Button>
                      </div>
                      {partTouched?.quantity && partErrors?.quantity && (
                        <p className="text-red-500 text-sm mt-1">{partErrors.quantity}</p>
                      )}
                    </div>
                    
                    <div>
                      <Label htmlFor={`parts[${index}].multiplier`}>
                        Part Multiplier
                      </Label>
                      <div className="flex">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-r-none"
                          onClick={() => handleMultiplierChange(index, 'decrease')}
                          disabled={part.multiplier <= 1}
                        >
                          -
                        </Button>
                        <Input
                          id={`parts[${index}].multiplier`}
                          name={`parts[${index}].multiplier`}
                          type="number"
                          min="1"
                          value={part.multiplier}
                          onChange={formikProps.handleChange}
                          onBlur={formikProps.handleBlur}
                          className="rounded-none text-center"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-l-none"
                          onClick={() => handleMultiplierChange(index, 'increase')}
                        >
                          +
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Use for identical variants or sub-assemblies
                      </p>
                    </div>
                    
                    <div>
                      <Label htmlFor={`parts[${index}].surfaceTreatment`}>
                        Surface Treatment
                      </Label>
                      <Select
                        name={`parts[${index}].surfaceTreatment`}
                        value={part.surfaceTreatment}
                        onValueChange={(value) => setFieldValue(`parts[${index}].surfaceTreatment`, value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="No surface treatment" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">No surface treatment</SelectItem>
                          <SelectItem value="anodizing">Anodizing</SelectItem>
                          <SelectItem value="powder-coating">Powder Coating</SelectItem>
                          <SelectItem value="painting">Painting</SelectItem>
                          <SelectItem value="plating">Plating</SelectItem>
                          <SelectItem value="polishing">Polishing</SelectItem>
                          <SelectItem value="sandblasting">Sandblasting</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label htmlFor={`parts[${index}].documentation`}>
                        Documentation / Certification
                      </Label>
                      <Select
                        name={`parts[${index}].documentation`}
                        value={part.documentation}
                        onValueChange={(value) => setFieldValue(`parts[${index}].documentation`, value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="No certification required" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No certification / documentation</SelectItem>
                          <SelectItem value="material-certificate">Material Certificate</SelectItem>
                          <SelectItem value="inspection-report">Inspection Report</SelectItem>
                          <SelectItem value="coc">Certificate of Conformity</SelectItem>
                          <SelectItem value="fai">First Article Inspection</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="md:col-span-2">
                      <Label htmlFor={`parts[${index}].comments`}>
                        Part-Specific Comments
                      </Label>
                      <Textarea
                        id={`parts[${index}].comments`}
                        name={`parts[${index}].comments`}
                        value={part.comments}
                        onChange={formikProps.handleChange}
                        placeholder="e.g. critical dimensions, tolerances, or special requirements for this part"
                        className="resize-y"
                      />
                    </div>
                  </div>

                  {/* Associate files section */}
                  {values.files.length > 0 && part.files.length === 0 && (
                    <div className="mt-6 border-t pt-4">
                      <h5 className="text-sm font-medium mb-2">Associate files with this part:</h5>
                      <div className="flex flex-wrap gap-2">
                        {values.files.map((file: File, fileIndex: number) => (
                          <div 
                            key={fileIndex} 
                            className="flex items-center bg-gray-100 rounded-md px-3 py-1"
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-teal-600 p-1 h-auto"
                              onClick={() => associateFileWithPart(index, file)}
                            >
                              <span className="text-xs">{file.name}</span>
                              <Plus size={14} className="ml-1" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            
            <Button
              type="button"
              onClick={() => arrayHelpers.push({
                name: `Part ${values.parts.length + 1}`,
                quantity: 1,
                multiplier: 1,
                files: [],
                process: '',
                material: '',
                materialSubtype: '',
                surfaceTreatment: '',
                documentation: 'none',
                comments: '',
              })}
              variant="outline"
              className="mt-4"
            >
              <Plus size={16} className="mr-2" /> Add Another Part
            </Button>
          </div>
        )}
      />

      {/* File upload dialog for parts */}
      <Dialog open={showFileUpload} onOpenChange={setShowFileUpload}>
        <DialogContent className="sm:max-w-md">
          <h3 className="text-lg font-medium mb-4">
            Upload Files for Part {currentEditingPart !== null ? currentEditingPart + 1 : ""}
          </h3>
          
          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            <input
              type="file"
              id="part-file-upload"
              className="hidden"
              onChange={(e) => {
                if (currentEditingPart !== null && e.target.files) {
                  handleFileUploadForPart(currentEditingPart, e.target.files);
                  e.target.value = '';
                }
              }}
              accept=".stp,.step,.stl,.pdf,.dxf,.dwg,.png,.jpg,.jpeg,.tiff,.tif"
              multiple
            />
            
            <CloudUpload className="mx-auto h-12 w-12 text-teal-600 mb-3" />
            
            <p className="text-gray-600 mb-4">
              Drag & drop files here or click to browse
            </p>
            
            <label htmlFor="part-file-upload" className="cursor-pointer">
              <span className="bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 transition-colors text-sm">
                Select files
              </span>
            </label>
          </div>
          
          {currentEditingPart !== null && values.parts[currentEditingPart].files?.length > 0 && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">Uploaded Files:</h4>
              {values.parts[currentEditingPart].files.map((file: File, fileIndex: number) => (
                <div key={fileIndex} className="flex justify-between items-center bg-white p-2 rounded border mb-2">
                  <span className="text-sm">{file.name}</span>
                  <Button 
                    variant="ghost"
                    size="sm"
                    className="text-gray-500 hover:text-red-500 p-1 h-auto"
                    onClick={() => removePartFile(currentEditingPart, fileIndex)}
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex justify-end mt-4">
            <Button 
              type="button" 
              onClick={() => setShowFileUpload(false)}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {errors.parts && typeof errors.parts === 'string' && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded flex items-start">
          <AlertTriangle className="text-red-500 mr-2 flex-shrink-0 mt-1" size={18} />
          <p className="text-red-700">{errors.parts}</p>
        </div>
      )}
    </div>
  );
};

export default StepPartDetails;
