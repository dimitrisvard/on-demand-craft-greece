
import React, { useState } from 'react';
import { Box, Plus, Trash2, Edit2, X, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import FileUploadStep from './FileUploadStep';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';

interface Part {
  name: string;
  process: string;
  material: string;
  materialSubtype: string;
  surfaceTreatment: string;
  quantity: number;
  tolerance: string;
  certification: string;
  files?: File[];
}

interface MaterialOptions {
  [key: string]: string[];
}

interface PartDetailsStepProps {
  parts: Part[];
  files: File[];
  updatePartDetails: (index: number, field: string, value: any) => void;
  addPart: () => void;
  removePart: (index: number) => void;
  updateFormState: (field: string, value: any) => void;
}

const PartDetailsStep: React.FC<PartDetailsStepProps> = ({ 
  parts, 
  files,
  updatePartDetails, 
  addPart,
  removePart,
  updateFormState
}) => {
  const [currentEditingPart, setCurrentEditingPart] = useState<number | null>(null);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showFilePreview, setShowFilePreview] = useState<{index: number, fileName: string} | null>(null);
  
  const materialOptions: MaterialOptions = {
    'aluminum': ['6061', '7075', '5052', '2024', 'A356', 'A380'],
    'steel': ['1018', '1045', '4140', 'A36', 'P20'],
    'stainless-steel': ['304', '316', '316L', '410', '17-4 PH'],
    'plastic': ['ABS', 'PLA', 'Nylon', 'PEEK', 'POM/Delrin', 'HDPE', 'Polycarbonate', 'TPU'],
    'brass': ['C360', 'C464', 'C260', 'C280'],
    'copper': ['C101', 'C110', 'C145'],
    'titanium': ['Grade 2', 'Grade 5 (Ti-6Al-4V)', 'Grade 9'],
    'other': ['Please specify in notes']
  };

  const handleQuantityChange = (index: number, action: 'increment' | 'decrement') => {
    const currentQuantity = parts[index].quantity;
    if (action === 'decrement' && currentQuantity > 1) {
      updatePartDetails(index, 'quantity', currentQuantity - 1);
    } else if (action === 'increment') {
      updatePartDetails(index, 'quantity', currentQuantity + 1);
    }
  };

  const handlePartFiles = ({ partIndex, files }: { partIndex: number, files: File[] }) => {
    updatePartDetails(partIndex, 'files', files);
    setShowFileUpload(false);
  };

  // Function to render the file preview
  const renderFilePreview = (fileName: string) => {
    const fileExtension = fileName.split('.').pop()?.toLowerCase();
    
    if (fileExtension === 'stl' || fileExtension === 'obj') {
      return (
        <div className="w-full h-64 flex items-center justify-center bg-gray-100 rounded-md">
          <p className="text-gray-500">3D model preview not available</p>
          <p className="text-sm text-gray-400">{fileName}</p>
        </div>
      );
    } else if (['png', 'jpg', 'jpeg', 'gif'].includes(fileExtension || '')) {
      // Find the file in the files array
      const fileObj = files.find(f => f.name === fileName);
      if (!fileObj) return <p>File not found</p>;

      const imageUrl = URL.createObjectURL(fileObj);
      
      return (
        <img 
          src={imageUrl} 
          alt={fileName} 
          className="max-w-full max-h-64 object-contain"
          onLoad={() => URL.revokeObjectURL(imageUrl)}
        />
      );
    } else {
      return (
        <div className="w-full h-64 flex flex-col items-center justify-center bg-gray-100 rounded-md">
          <p className="text-gray-500">Preview not available for this file type</p>
          <p className="text-sm text-gray-400">{fileName}</p>
        </div>
      );
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold">Parts Overview</h3>
        
        {parts.length > 1 && (
          <div className="text-sm text-gray-500">
            Parts list: {parts.length}
          </div>
        )}
      </div>

      <div className="space-y-8">
        {parts.map((part, index) => (
          <div key={index} className="border rounded-lg p-4 bg-white">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center">
                <Box className="text-teal-600 mr-2" />
                <div className="text-lg font-medium">
                  Part {index + 1} 
                  {part.files && part.files.length > 0 && (
                    <span className="ml-2 text-sm text-gray-500">
                      - {part.files[0].name}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {part.files && part.files.length > 0 && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <button 
                        onClick={() => setShowFilePreview({index, fileName: part.files![0].name})}
                        className="text-teal-500 hover:text-teal-700 transition-colors"
                        type="button"
                      >
                        <Eye size={18} />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <div className="p-4">
                        <h3 className="text-lg font-medium mb-4">File Preview</h3>
                        {renderFilePreview(part.files[0].name)}
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
                
                <button 
                  onClick={() => {
                    setCurrentEditingPart(index);
                    setShowFileUpload(true);
                  }}
                  className="text-teal-500 hover:text-teal-700 transition-colors"
                  type="button"
                >
                  <Edit2 size={18} />
                </button>
                
                {parts.length > 1 && (
                  <button 
                    onClick={() => removePart(index)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    type="button"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Manufacturing process <span className="text-red-500">*</span>
                </label>
                <Select
                  value={part.process}
                  onValueChange={(value) => updatePartDetails(index, 'process', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Please select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cnc-machining">CNC Machining</SelectItem>
                    <SelectItem value="sheet-metal">Sheet Metal Processing</SelectItem>
                    <SelectItem value="casting">Casting</SelectItem>
                    <SelectItem value="injection-molding">Injection Molding</SelectItem>
                    <SelectItem value="forming">Forming</SelectItem>
                    <SelectItem value="3d-printing">3D Printing</SelectItem>
                    <SelectItem value="other">Other Process</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Material <span className="text-red-500">*</span>
                </label>
                <Select
                  value={part.material}
                  onValueChange={(value) => {
                    updatePartDetails(index, 'material', value);
                    updatePartDetails(index, 'materialSubtype', '');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Please select" />
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
              </div>
              
              {part.material && part.material !== '' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Material Type <span className="text-red-500">*</span>
                  </label>
                  <Select
                    value={part.materialSubtype}
                    onValueChange={(value) => updatePartDetails(index, 'materialSubtype', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Please select material type" />
                    </SelectTrigger>
                    <SelectContent>
                      {materialOptions[part.material]?.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Surface treatment
                </label>
                <Select
                  value={part.surfaceTreatment}
                  onValueChange={(value) => updatePartDetails(index, 'surfaceTreatment', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No surface treatment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No surface treatment</SelectItem>
                    <SelectItem value="anodizing">Anodizing</SelectItem>
                    <SelectItem value="powder-coating">Powder Coating</SelectItem>
                    <SelectItem value="painting">Painting</SelectItem>
                    <SelectItem value="plating">Plating</SelectItem>
                    <SelectItem value="polishing">Polishing</SelectItem>
                    <SelectItem value="sandblasting">Sandblasting</SelectItem>
                    <SelectItem value="other">Other Treatment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity
                </label>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(index, 'decrement')}
                    className="px-3 py-2 border border-gray-300 rounded-l text-gray-600 hover:bg-gray-100"
                  >
                    −
                  </button>
                  <Input
                    type="number"
                    value={part.quantity}
                    onChange={(e) => updatePartDetails(index, 'quantity', parseInt(e.target.value) || 1)}
                    min="1"
                    className="w-20 text-center rounded-none border-l-0 border-r-0"
                  />
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(index, 'increment')}
                    className="px-3 py-2 border border-gray-300 rounded-r text-gray-600 hover:bg-gray-100"
                  >
                    +
                  </button>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tolerance
                </label>
                <Select
                  value={part.tolerance}
                  onValueChange={(value) => updatePartDetails(index, 'tolerance', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Standard tolerance" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard tolerance</SelectItem>
                    <SelectItem value="precise">Precise tolerance (±0.05mm)</SelectItem>
                    <SelectItem value="high">High precision (±0.01mm)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Certifications / Documentation
                </label>
                <Select
                  value={part.certification}
                  onValueChange={(value) => updatePartDetails(index, 'certification', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No certification / documentation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no certification / documentation">No certification / documentation</SelectItem>
                    <SelectItem value="material-certificate">Material Certificate</SelectItem>
                    <SelectItem value="inspection-report">Inspection Report</SelectItem>
                    <SelectItem value="coc">Certificate of Conformity</SelectItem>
                    <SelectItem value="fai">First Article Inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Button
          type="button"
          variant="outline"
          className="flex items-center text-teal-600 border-teal-600"
          onClick={addPart}
        >
          <Plus className="mr-1" size={16} />
          Add more parts
        </Button>
      </div>

      {/* Dialog for file upload for a specific part */}
      <Dialog open={showFileUpload} onOpenChange={setShowFileUpload}>
        <DialogContent className="sm:max-w-lg">
          <div className="p-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Upload Files for Part {currentEditingPart !== null ? currentEditingPart + 1 : ""}</h3>
              <button 
                onClick={() => setShowFileUpload(false)} 
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>
            
            {currentEditingPart !== null && (
              <FileUploadStep 
                files={parts[currentEditingPart].files || []}
                updateFormState={updateFormState}
                currentPart={currentEditingPart}
                isAddingToPart={true}
              />
            )}
            
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setShowFileUpload(false)}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PartDetailsStep;
