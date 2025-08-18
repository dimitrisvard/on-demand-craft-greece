
import { useState, useEffect } from 'react';
import { CloudUpload, Plus, Trash2, Check, Info, ChevronLeft, ChevronRight, Clock, Scale, Truck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import FileUploadStep from './FileUploadStep';
import PartDetailsStep from './PartDetailsStep';
import DeliveryOptionsStep from './DeliveryOptionsStep';
import ContactDetailsStep from './ContactDetailsStep';

const steps = [
  { id: 1, name: "Upload Files" },
  { id: 2, name: "Part Details" },
  { id: 3, name: "Delivery Options" },
  { id: 4, name: "Contact Details" },
  { id: 5, name: "Review & Submit" }
];

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

const RequestForm = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formState, setFormState] = useState({
    files: [] as File[],
    parts: [{
      name: 'part1',
      process: '',
      material: '',
      materialSubtype: '',
      surfaceTreatment: '',
      quantity: 1,
      tolerance: '',
      certification: 'no certification / documentation',
      files: [] as File[]
    }] as Part[],
    deliveryOption: 'standard',
    deliveryDate: '',
    contactEmail: '',
    termsAccepted: false,
    privacyAccepted: false,
    businessUse: false,
    validateContactStep: () => true
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const { toast } = useToast();

  const nextStep = () => {
    // Validation for step 1 - require files
    if (currentStep === 1 && formState.files.length === 0) {
      toast({
        title: "Error",
        description: "Please upload at least one file to continue",
        variant: "destructive",
      });
      return;
    }
    
    // Validation for step 2 - require process and material
    if (currentStep === 2) {
      const invalidParts = formState.parts.filter(
        part => !part.process || !part.material || (part.material && !part.materialSubtype)
      );
      
      if (invalidParts.length > 0) {
        toast({
          title: "Error",
          description: "Please complete all required fields for each part",
          variant: "destructive",
        });
        return;
      }
    }
    
    // Validation for step 4 - check email and agreements
    if (currentStep === 4) {
      const isValid = formState.validateContactStep();
      if (!isValid) {
        return;
      }
    }
    
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const updateFormState = (field: string, value: any) => {
    if (field === 'partFiles' && typeof value === 'object') {
      // Handle files for specific parts
      const { partIndex, files } = value;
      const updatedParts = [...formState.parts];
      
      if (updatedParts[partIndex]) {
        updatedParts[partIndex] = {
          ...updatedParts[partIndex],
          files
        };
        
        setFormState({
          ...formState,
          parts: updatedParts
        });
      }
    } else {
      setFormState({
        ...formState,
        [field]: value
      });
    }
  };

  const updatePartDetails = (index: number, field: string, value: any) => {
    const updatedParts = [...formState.parts];
    updatedParts[index] = {
      ...updatedParts[index],
      [field]: value
    };
    
    setFormState({
      ...formState,
      parts: updatedParts
    });
  };

  const addPart = () => {
    setFormState({
      ...formState,
      parts: [
        ...formState.parts,
        {
          name: `part${formState.parts.length + 1}`,
          process: '',
          material: '',
          materialSubtype: '',
          surfaceTreatment: '',
          quantity: 1,
          tolerance: '',
          certification: 'no certification / documentation',
          files: []
        }
      ]
    });
  };

  const removePart = (index: number) => {
    const updatedParts = formState.parts.filter((_, i) => i !== index);
    setFormState({
      ...formState,
      parts: updatedParts
    });
  };

  const handleSubmit = () => {
    if (!formState.termsAccepted || !formState.privacyAccepted) {
      toast({
        title: "Error",
        description: "You must accept terms and conditions to proceed",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);
    
    // Simulate form submission
    setTimeout(() => {
      setIsSubmitting(false);
      setIsComplete(true);
    }, 1500);
  };

  const renderStepIndicator = () => {
    return (
      <div className="relative mb-10">
        <div className="flex items-center justify-center">
          <div className="w-full bg-gray-200 h-1 absolute"></div>
          <div className="flex justify-between w-full relative">
            {steps.map((step) => (
              <div key={step.id} className="flex flex-col items-center">
                <div 
                  className={`w-8 h-8 flex items-center justify-center rounded-full z-10 ${
                    step.id < currentStep ? 'bg-teal-600 text-white' : 
                    step.id === currentStep ? 'bg-teal-600 text-white' : 
                    'bg-white border border-gray-300 text-gray-500'
                  }`}
                >
                  {step.id < currentStep ? <Check size={16} /> : step.id}
                </div>
                <span className="mt-2 text-xs hidden sm:block">{step.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderFormStep = () => {
    switch(currentStep) {
      case 1:
        return (
          <FileUploadStep 
            files={formState.files} 
            updateFormState={updateFormState} 
          />
        );
      case 2:
        return (
          <PartDetailsStep 
            parts={formState.parts}
            files={formState.files}
            updatePartDetails={updatePartDetails}
            addPart={addPart}
            removePart={removePart}
            updateFormState={updateFormState}
          />
        );
      case 3:
        return (
          <DeliveryOptionsStep
            deliveryOption={formState.deliveryOption}
            deliveryDate={formState.deliveryDate}
            updateFormState={updateFormState}
          />
        );
      case 4:
        return (
          <ContactDetailsStep
            email={formState.contactEmail}
            termsAccepted={formState.termsAccepted}
            privacyAccepted={formState.privacyAccepted}
            businessUse={formState.businessUse}
            updateFormState={updateFormState}
            validateStep={() => true}
          />
        );
      case 5:
        return (
          <div className="space-y-6">
            <h3 className="text-xl font-bold">Review Your Quote Request</h3>
            
            <div className="border rounded-md p-4">
              <h4 className="font-medium mb-2">Files</h4>
              <p>{formState.files.length > 0 ? 
                formState.files.map(f => f.name).join(', ') : 
                'No files uploaded'}</p>
            </div>
            
            <div className="border rounded-md p-4">
              <h4 className="font-medium mb-2">Parts ({formState.parts.length})</h4>
              {formState.parts.map((part, index) => (
                <div key={index} className="mb-3 border-b pb-3 last:border-0">
                  <p>
                    <span className="font-medium">Part {index + 1}:</span> {part.process || 'No process selected'}
                    {part.files && part.files.length > 0 && (
                      <span className="text-sm text-gray-500 ml-2">({part.files[0].name})</span>
                    )}
                  </p>
                  <p><span className="font-medium">Material:</span> {part.material ? `${part.material} - ${part.materialSubtype || 'Not specified'}` : 'Not specified'}</p>
                  <p><span className="font-medium">Quantity:</span> {part.quantity}</p>
                </div>
              ))}
            </div>
            
            <div className="border rounded-md p-4">
              <h4 className="font-medium mb-2">Delivery</h4>
              <p><span className="font-medium">Option:</span> {formState.deliveryOption}</p>
              {formState.deliveryDate && <p><span className="font-medium">Date:</span> {formState.deliveryDate}</p>}
            </div>
            
            <div className="border rounded-md p-4">
              <h4 className="font-medium mb-2">Contact</h4>
              <p>{formState.contactEmail || 'No email provided'}</p>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="terms" 
                checked={formState.termsAccepted}
                onCheckedChange={(checked) => updateFormState('termsAccepted', checked)}
              />
              <label htmlFor="terms" className="text-sm">
                I accept the <a href="#" className="text-teal-600 hover:underline">terms and conditions</a>
              </label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="privacy"
                checked={formState.privacyAccepted}
                onCheckedChange={(checked) => updateFormState('privacyAccepted', checked)}
              />
              <label htmlFor="privacy" className="text-sm">
                I agree to the storage and processing of my data (see <a href="#" className="text-teal-600 hover:underline">privacy policy</a>)
              </label>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderCompletionScreen = () => {
    return (
      <div className="text-center py-12">
        <div className="bg-teal-600 rounded-full h-24 w-24 flex items-center justify-center mx-auto mb-8">
          <Check className="text-white h-12 w-12" />
        </div>
        <h2 className="text-2xl font-bold mb-4">Thank you for your request!</h2>
        <p className="mb-8">We will send you an offer as soon as possible.</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button variant="outline" onClick={() => window.location.href = "/"}>
            Homepage
          </Button>
          <Button onClick={() => {
            setIsComplete(false);
            setCurrentStep(1);
            setFormState({
              files: [],
              parts: [{
                name: 'part1',
                process: '',
                material: '',
                materialSubtype: '',
                surfaceTreatment: '',
                quantity: 1,
                tolerance: '',
                certification: 'no certification / documentation',
                files: []
              }],
              deliveryOption: 'standard',
              deliveryDate: '',
              contactEmail: '',
              termsAccepted: false,
              privacyAccepted: false,
              businessUse: false,
              validateContactStep: () => true
            });
          }}>
            New Inquiry
          </Button>
        </div>
      </div>
    );
  };

  if (isComplete) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6 md:p-8">
        {renderStepIndicator()}
        {renderCompletionScreen()}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 md:p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-teal-700 mb-2">Online Inquiry</h2>
        <p className="text-gray-600">Complete the form below to request a quote for your manufacturing needs.</p>
      </div>
      
      {renderStepIndicator()}
      {renderFormStep()}
      
      <div className="mt-8 flex justify-between">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={currentStep === 1}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        
        {currentStep < steps.length ? (
          <Button onClick={nextStep}>
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </>
            ) : "Submit Request"}
          </Button>
        )}
      </div>
    </div>
  );
};

export default RequestForm;
