import React, { useState } from 'react';
import { Formik, Form, FormikHelpers } from 'formik';
import * as Yup from 'yup';
import { FormValues } from './types';
import StepCompanyInfo from './steps/StepCompanyInfo';
import StepFileUpload from './steps/StepFileUpload';
import StepPartDetails from './steps/StepPartDetails';
import StepDeliveryOptions from './steps/StepDeliveryOptions';
import StepReviewSubmit from './steps/StepReviewSubmit';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { uploadFile } from '@/utils/fileStorage';
import { sendRFQEmails } from '@/utils/emailService';
import { trackQuoteFormSubmitSuccess } from '@/utils/analytics';

const steps = [
  { name: 'Company Info', component: StepCompanyInfo },
  { name: 'Upload Files', component: StepFileUpload },
  { name: 'Part Details', component: StepPartDetails },
  { name: 'Delivery Options', component: StepDeliveryOptions },
  { name: 'Review & Submit', component: StepReviewSubmit },
];

const initialValues: FormValues = {
  companyName: '',
  vatId: '',
  address: {
    street: '',
    city: '',
    zipCode: '',
    country: 'United States', // Set a default country
  },
  contact: {
    firstName: '',
    lastName: '',
    position: '',
    email: '',
    phone: '',
  },
  files: [],
  additionalFiles: [],
  generalNotes: '',
  internalRequestNumber: '',
  parts: [
    {
      name: 'Part 1',
      quantity: 1,
      multiplier: 1,
      files: [],
      process: '',
      material: '',
      materialSubtype: '',
      surfaceRoughness: '',
      surfaceTreatment: '',
      documentation: 'none',
      comments: '',
      userModifiedName: false,
      tolerance: '',
      surfaceTreatmentOther: '',
    },
  ],
  delivery: {
    speed: 'standard',
    maxDeliveryDate: '',
    latestOfferDate: '',
  },
  confirmEmail: '',
  termsAccepted: false,
  captchaToken: '',
};

// Modified validation schema to fix potential issues
const validationSchema = Yup.object({
  companyName: Yup.string().required('Company name is required'),
  contact: Yup.object({
    firstName: Yup.string().required('First name is required'),
    lastName: Yup.string().required('Last name is required'),
    email: Yup.string().email('Invalid email address').required('Email is required'),
    phone: Yup.string().required('Phone number is required'),
  }),
  address: Yup.object({
    street: Yup.string().required('Street address is required'),
    city: Yup.string().required('City is required'),
    zipCode: Yup.string().required('ZIP/Postal code is required'),
    country: Yup.string().required('Country is required'),
  }),
  files: Yup.array().min(1, 'At least one file is required'),
  termsAccepted: Yup.boolean().oneOf([true], 'You must accept the terms and conditions'),
});

const MicronsMultiStepForm: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const { toast } = useToast();

  // Handle next step with validation
  const handleNext = async (formikProps: any) => {
    const { validateForm, values, setTouched, setFieldValue } = formikProps;
    
    // Get errors for current step
    const errors = await validateForm(values);
    
    // Check if we have any errors relevant to the current step
    let hasErrors = false;
    
    if (currentStep === 0) {
      // Company info validation
      if (errors.companyName || errors.contact || errors.address) {
        hasErrors = true;
        setTouched({
          companyName: true,
          'contact.firstName': true,
          'contact.lastName': true,
          'contact.email': true,
          'contact.phone': true,
          'address.street': true,
          'address.city': true,
          'address.zipCode': true,
          'address.country': true,
        });
      }
    } else if (currentStep === 1) {
      // File upload validation
      if (values.files.length === 0) {
        toast({
          title: "No files uploaded",
          description: "Please upload at least one file to continue",
          variant: "destructive",
        });
        hasErrors = true;
      }
    } else if (currentStep === 2) {
      // Part details validation
      if (values.parts.some((part: any) => !part.process || !part.material)) {
        toast({
          title: "Incomplete part details",
          description: "Please complete all required fields for each part",
          variant: "destructive",
        });
        hasErrors = true;
      }
    }
    
    if (!hasErrors) {
      if (currentStep < steps.length - 1) {
        setCurrentStep(currentStep + 1);
        window.scrollTo(0, 0);
      }
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      window.scrollTo(0, 0);
    }
  };

  const createRfqFromQuote = async (values: FormValues) => {
    try {
      // Generate RFQ number
      const today = new Date();
      const formattedDate = today.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).split('/').join('');
      
      // Check existing RFQ numbers for today to get the next sequence number
      const { data: existingRfqs, error: rfqsError } = await supabase
        .from('rfqs')
        .select('rfq_number')
        .like('rfq_number', `RFQ-${formattedDate}-%`)
        .order('rfq_number', { ascending: false });
        
      if (rfqsError) {
        console.error('Error getting existing RFQs:', rfqsError);
        throw rfqsError;
      }
      
      let sequenceNumber = 1;
      if (existingRfqs && existingRfqs.length > 0) {
        // Extract the highest sequence number and increment by 1
        const latestRfq = existingRfqs[0];
        if (latestRfq && 'rfq_number' in latestRfq) {
          const rfqNumber = latestRfq.rfq_number as string;
          const match = rfqNumber.match(/RFQ-\d{8}-(\d+)/);
          if (match && match[1]) {
            sequenceNumber = parseInt(match[1], 10) + 1;
          }
        }
      }
      
      const rfqNumber = `RFQ-${formattedDate}-${sequenceNumber}`;
      console.log('Generated RFQ number:', rfqNumber);

      // Note: Customer creation removed - RFQs will be created without customer assignment
      // Customer can be assigned later manually through admin interface
      
      // Create RFQ with calculated delivery date and parts details
      const dueDate = values.delivery.maxDeliveryDate 
        ? new Date(values.delivery.maxDeliveryDate) 
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default to 1 week from now
        
      // Convert parts to RfqItems format
      const partsDetails = values.parts.map(part => ({
        id: crypto.randomUUID(),
        rfq_id: '', // Will be filled in after RFQ creation
        product_name: part.name,
        description: `Process: ${part.process}\nMaterial: ${part.material}${part.materialSubtype ? ` (${part.materialSubtype})` : ''}\nSurface Roughness: ${part.surfaceRoughness}\nSurface Treatment: ${part.surfaceTreatment}\nDocumentation: ${part.documentation}\nComments: ${part.comments}`,
        quantity: part.quantity * part.multiplier,
        unit_price: 0, // Will be filled in later
        total_price: 0, // Will be filled in later
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
        
      const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .insert([
          {
            title: `${rfqNumber} - ${values.companyName}`,
            company_name: values.companyName,
            vat_id: values.vatId,
            address: values.address?.street,
            city: values.address?.city,
            zip_code: values.address?.zipCode,
            country: values.address?.country,
            contact_first_name: values.contact?.firstName,
            contact_last_name: values.contact?.lastName,
            contact_position: values.contact?.position,
            contact_email: values.contact?.email,
            contact_phone: values.contact?.phone,
            mobile: values.contact?.mobile,
            customer_id: null, // No customer assigned initially
            status: 'draft',
            currency: 'EUR',
            due_date: dueDate.toISOString(),
            version: 1,
            description: values.generalNotes,
            parts_details: partsDetails,
            rfq_number: rfqNumber
          }
        ])
        .select()
        .single();
        
      if (rfqError) {
        console.error('Error creating RFQ:', rfqError);
        throw rfqError;
      }

      // Update parts with the correct rfq_id
      const updatedPartsDetails = partsDetails.map(part => ({
        ...part,
        rfq_id: rfqData.id
      }));

      // Update the RFQ with the correct rfq_id in parts_details
      const { error: updateError } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedPartsDetails })
        .eq('id', rfqData.id);

      if (updateError) {
        console.error('Error updating RFQ parts:', updateError);
        throw updateError;
      }

      // Upload files
      const uploadPromises = [];

      // Upload general files
      for (const file of values.files) {
        const filePath = `rfq/${rfqData.id}/general/${file.name}`;
        uploadPromises.push(
          uploadFile(file, filePath).then(async (fileUrl) => {
            const { error: fileError } = await supabase
              .from('rfq_files')
              .insert([
                {
                  rfq_id: rfqData.id,
                  file_name: file.name,
                  file_path: filePath,
                  file_type: file.type,
                  file_size: file.size
                }
              ]);
            if (fileError) throw fileError;
          })
        );
      }

      // Upload part-specific files
      values.parts.forEach((part, index) => {
        part.files.forEach((file) => {
          const filePath = `rfq/${rfqData.id}/parts/${updatedPartsDetails[index].id}/${file.name}`;
          uploadPromises.push(
            uploadFile(file, filePath).then(async (fileUrl) => {
              const { error: fileError } = await supabase
                .from('rfq_files')
                .insert([
                  {
                    rfq_id: rfqData.id,
                    part_id: updatedPartsDetails[index].id,
                    file_name: file.name,
                    file_path: filePath,
                    file_type: file.type,
                    file_size: file.size
                  }
                ]);
              if (fileError) throw fileError;
            })
          );
        });
      });

      // Wait for all file uploads to complete
      await Promise.all(uploadPromises);

      return { ...rfqData, rfqNumber };
    } catch (error) {
      console.error('Error in createRfqFromQuote:', error);
      throw error;
    }
  };

  const handleSubmit = async (values: FormValues, formikHelpers: FormikHelpers<FormValues>) => {
    setIsSubmitting(true);
    
    try {
      // Create RFQ from the quote data
      const rfqData = await createRfqFromQuote(values);
      
      if (!rfqData) {
        throw new Error('Failed to create RFQ');
      }
      
      // Send confirmation and notification emails
      try {
        console.log('Sending RFQ confirmation and notification emails...');
        const emailResult = await sendRFQEmails({
          customerName: `${values.contact.firstName} ${values.contact.lastName}`,
          customerEmail: values.contact.email,
          companyName: values.companyName,
          rfqNumber: rfqData.rfqNumber,
          phone: values.contact.phone
        });
        
        if (emailResult.confirmationSent) {
          console.log('Confirmation email sent successfully');
        } else {
          console.warn('Failed to send confirmation email');
        }
        
        if (emailResult.notificationSent) {
          console.log('Notification email sent successfully');
        } else {
          console.warn('Failed to send notification email');
        }
      } catch (emailError) {
        console.error('Error sending emails:', emailError);
        // Don't throw error here - we don't want email failures to break the form submission
      }
      
      // Track Google Ads conversion for form submission success
      trackQuoteFormSubmitSuccess();

      // Show success message
      setSubmitSuccess(true);
      toast({
        title: "Quote Submitted Successfully",
        description: "Your quote request has been received. We'll get back to you soon!",
      });
      
      // Reset form
      formikHelpers.resetForm();
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "There was an error submitting your quote. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitSuccess) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="h-16 w-16 flex items-center justify-center bg-green-100 rounded-full mb-6">
          <Check className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-4">Quote Request Submitted!</h2>
        <p className="text-gray-600 mb-8 max-w-md">
          Thank you for your submission. Our team will review your quote request and get back to you shortly.
        </p>
        <div className="flex space-x-4">
          <Button variant="outline" onClick={() => window.location.href = "/"}>
            Return to Homepage
          </Button>
          <Button onClick={() => {
            setSubmitSuccess(false);
            setCurrentStep(0);
          }}>
            Submit Another Quote
          </Button>
        </div>
      </div>
    );
  }

  const StepComponent = steps[currentStep].component;

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={handleSubmit}
    >
      {(formikProps) => (
        <Form className="space-y-8">
          <div className="mb-8">
            <div className="flex items-center justify-center mb-6">
              <div className="w-full bg-gray-200 h-1">
                <div
                  className="bg-primary h-1"
                  style={{
                    width: `${((currentStep + 1) / steps.length) * 100}%`,
                    transition: 'width 0.3s ease',
                  }}
                ></div>
              </div>
            </div>
            <div className="flex justify-between">
              {steps.map((step, index) => (
                <div
                  key={index}
                  className={`text-sm flex flex-col items-center ${
                    index <= currentStep ? 'text-primary' : 'text-gray-400'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center mb-1 ${
                      index <= currentStep ? 'bg-primary text-white' : 'bg-gray-200'
                    }`}
                  >
                    {index < currentStep ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <span className="text-xs">{index + 1}</span>
                    )}
                  </div>
                  <span className="hidden sm:block">{step.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h2 className="text-xl font-bold mb-6">{steps[currentStep].name}</h2>
            <StepComponent formikProps={formikProps} />
          </div>

          <div className="flex justify-between pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handlePrevious}
              disabled={currentStep === 0}
            >
              <ChevronLeft className="mr-2 h-4 w-4" /> Previous
            </Button>
            
            {currentStep < steps.length - 1 ? (
              <Button 
                type="button" 
                onClick={() => handleNext(formikProps)}
              >
                Next <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button 
                type="submit" 
                disabled={isSubmitting || !formikProps.values.termsAccepted}
              >
                {isSubmitting ? (
                  <>
                    <svg 
                      className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" 
                      xmlns="http://www.w3.org/2000/svg" 
                      fill="none" 
                      viewBox="0 0 24 24"
                    >
                      <circle 
                        className="opacity-25" 
                        cx="12" 
                        cy="12" 
                        r="10" 
                        stroke="currentColor" 
                        strokeWidth="4"
                      />
                      <path 
                        className="opacity-75" 
                        fill="currentColor" 
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Processing...
                  </>
                ) : (
                  'Submit Quote Request'
                )}
              </Button>
            )}
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default MicronsMultiStepForm;
