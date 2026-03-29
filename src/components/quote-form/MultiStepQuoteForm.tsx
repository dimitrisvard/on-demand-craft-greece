import React, { useState, useEffect, useRef } from 'react';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { uploadFileToS3 } from '@/utils/awsS3Storage';
import StepCompanyInfo from './steps/StepCompanyInfo';
import StepPartDetails from './steps/StepPartDetails';
import StepDeliveryOptions from './steps/StepDeliveryOptions';
import StepReviewSubmit from './steps/StepReviewSubmit';
import { FormValues } from './types';
import { materialOptions, surfaceRoughnessOptions, toleranceOptions, surfaceTreatmentOptions } from './constants/materialOptions';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import { trackQuoteRequest, trackFormSubmission, trackQuoteFormSubmitSuccess } from '@/utils/analytics';
import { sendRFQEmails } from '@/utils/emailService';

const validationSchemas = [
  // Step 1: Company & Contact Information
  Yup.object().shape({
    companyName: Yup.string().required('Company name is required'),
    vatId: Yup.string().required('VAT ID is required'),
    address: Yup.object().shape({
      street: Yup.string().required('Street address is required'),
      city: Yup.string().required('City is required'),
      zipCode: Yup.string().required('ZIP code is required'),
      country: Yup.string().required('Country is required'),
    }),
    contact: Yup.object().shape({
      firstName: Yup.string().required('First name is required'),
      lastName: Yup.string().required('Last name is required'),
      position: Yup.string(),
      email: Yup.string().email('Invalid email').required('Email is required'),
      phone: Yup.string().required('Phone number is required'),
      mobile: Yup.string(),
    }),
  }),

  // Step 2: Part Details & Files
  Yup.object().shape({
    parts: Yup.array().of(
      Yup.object().shape({
        name: Yup.string().required('Part name is required'),
        quantity: Yup.number().min(1, 'Quantity must be at least 1').required('Quantity is required'),
        process: Yup.string().required('Manufacturing process is required'),
        material: Yup.string().required('Material is required'),
        materialSubtype: Yup.string().required('Material grade is required'),
      })
    ).min(1, 'At least one part is required'),
  }),

  // Step 3: Delivery Options
  Yup.object().shape({
    delivery: Yup.object().shape({
      speed: Yup.string().required('Delivery speed is required'),
      maxDeliveryDate: Yup.string(),
      latestOfferDate: Yup.string(),
    }),
  }),

  // Step 4: Review & Submit
  Yup.object().shape({
    termsAccepted: Yup.boolean().oneOf([true], 'You must accept the terms and conditions'),
  }),
];

const initialValues: FormValues = {
  // Step 1: Company & Contact Information
  companyName: '',
  vatId: '',
  address: {
    street: '',
    city: '',
    zipCode: '',
    country: '',
  },
  contact: {
    firstName: '',
    lastName: '',
    position: '',
    email: '',
    phone: '',
    mobile: '',
  },

  // Step 2: Part Details & Files
  parts: [{
    name: 'Part 1',
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
  }],
  generalNotes: '',
  internalRequestNumber: '',

  // Step 3: Delivery Options
  delivery: {
    speed: '',
    maxDeliveryDate: '',
    latestOfferDate: '',
  },

  // Step 4: Review & Submit
  termsAccepted: false,
  captchaToken: '',
};

interface MultiStepQuoteFormProps {
  isOrder?: boolean;
  skipCompanyStep?: boolean;
}

const MultiStepQuoteForm: React.FC<MultiStepQuoteFormProps> = ({ isOrder = false, skipCompanyStep = false }) => {
  const [currentStep, setCurrentStep] = useState(skipCompanyStep ? 1 : 0);
  const [prefillValues, setPrefillValues] = useState<Partial<typeof initialValues> | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();

  // Pre-fill company info from customer profile when skipping company step
  useEffect(() => {
    if (!skipCompanyStep || !user) return;
    const loadProfile = async () => {
      try {
        const { data } = await supabase
          .from('customer_profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();
        if (data) {
          setPrefillValues({
            companyName: data.company_name || user.email || 'Customer',
            vatId: data.vat_id || 'N/A',
            address: {
              street: data.address || 'N/A',
              city: data.city || 'N/A',
              zipCode: data.zip_code || '00000',
              country: data.country || 'GR',
            },
            contact: {
              firstName: data.first_name || user.user_metadata?.first_name || 'Customer',
              lastName: data.last_name || user.user_metadata?.last_name || '',
              position: '',
              email: user.email || '',
              phone: data.phone || 'N/A',
              mobile: '',
            },
          });
        } else {
          // No profile, fill with defaults so validation passes
          setPrefillValues({
            companyName: user.email || 'Customer',
            vatId: 'N/A',
            address: { street: 'N/A', city: 'N/A', zipCode: '00000', country: 'GR' },
            contact: {
              firstName: user.user_metadata?.first_name || 'Customer',
              lastName: user.user_metadata?.last_name || '',
              position: '',
              email: user.email || '',
              phone: 'N/A',
              mobile: '',
            },
          });
        }
      } catch {
        setPrefillValues({
          companyName: user.email || 'Customer',
          vatId: 'N/A',
          address: { street: 'N/A', city: 'N/A', zipCode: '00000', country: 'GR' },
          contact: {
            firstName: user.user_metadata?.first_name || 'Customer',
            lastName: user.user_metadata?.last_name || '',
            position: '',
            email: user.email || '',
            phone: 'N/A',
            mobile: '',
          },
        });
      }
    };
    loadProfile();
  }, [skipCompanyStep, user]);

  const steps = [
    { title: t('quote_form_step_company_contact'), component: StepCompanyInfo },
    { title: t('quote_form_step_parts_files'), component: StepPartDetails },
    { title: t('quote_form_step_delivery'), component: StepDeliveryOptions },
    { title: t('quote_form_step_review_submit'), component: StepReviewSubmit },
  ];

  const handleNext = async (values: FormValues, setErrors: any, setTouched: any) => {
    try {
      console.log('Validating step:', currentStep);
      console.log('Current values:', values);
      
      // Validate the current step
      await validationSchemas[currentStep].validate(values, { abortEarly: false });
      
      console.log('Validation passed, moving to next step');
      
      // Scroll to top immediately before state change
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      // Change step with a slight delay to ensure scroll position is reset
      setTimeout(() => {
        setCurrentStep((prev) => {
          const nextStep = Math.min(prev + 1, steps.length - 1);
          console.log('Setting step to:', nextStep);
          return nextStep;
        });
        
        // Ensure scroll is at top again after state update
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }, 50);
      }, 50);
      
    } catch (err) {
      console.error('Validation error:', err);
      if (err instanceof Yup.ValidationError) {
        const errors = err.inner.reduce((acc, error) => {
          if (error.path) {
            acc[error.path] = error.message;
          }
          return acc;
        }, {} as Record<string, string>);

        setErrors(errors);
        setTouched(Object.keys(errors).reduce((acc, key) => {
          acc[key] = true;
          return acc;
        }, {} as Record<string, boolean>));

        toast({
          title: "Validation Error",
          description: "Please check the form for errors",
          variant: "destructive"
        });
      }
    }
  };

  const handleBack = () => {
    const minStep = skipCompanyStep ? 1 : 0;
    setCurrentStep((prev) => Math.max(prev - 1, minStep));
  };

  const handleSubmit = async (values: FormValues, { setSubmitting, setErrors, setTouched }: any) => {
    console.log('Formik handleSubmit called with values:', values);
    try {
      console.log('Starting form submission...');
      
      // Validate all steps before submission (skip step 0 if company step is skipped)
      const startSchema = skipCompanyStep ? 1 : 0;
      for (let i = startSchema; i < validationSchemas.length; i++) {
        console.log('Validating with schema:', i);
        await validationSchemas[i].validate(values, { abortEarly: false });
      }

      // Generate RFQ/ORD number
      const rfqPrefix = isOrder ? 'ORD' : 'RFQ';
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
        .like('rfq_number', `${rfqPrefix}-${formattedDate}-%`)
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
          const match = rfqNumber.match(new RegExp(`${rfqPrefix}-\\d{8}-(\\d+)`));
          if (match && match[1]) {
            sequenceNumber = parseInt(match[1], 10) + 1;
          }
        }
      }

      const rfqNumber = `${rfqPrefix}-${formattedDate}-${sequenceNumber}`;
      console.log('Generated RFQ number:', rfqNumber);

      // Note: Customer creation removed - RFQs will be created without customer assignment
      // Customer can be assigned later manually through admin interface

      // Create RFQ with calculated delivery date and parts details
      const partsDetails = values.parts.map((part, index) => {
        // Get the display labels instead of values for better readability
        const processLabel = part.process ? 
          { 'cnc-milling': 'CNC Milling', 'turning': 'Turning', 'laser-cutting': 'Laser Cutting', 
            '3d-printing': '3D Printing', 'injection-molding': 'Injection Molding', 
            'sheet-metal': 'Sheet Metal', 'die-casting': 'Die Casting', 
            'vacuum-casting': 'Vacuum Casting', 'surface-treatments': 'Surface Treatments' }[part.process] || part.process 
          : '';
        
        const materialLabel = part.material ? 
          materialOptions.find(m => m.value === part.material)?.label || part.material 
          : '';
        
        const materialSubtypeLabel = part.materialSubtype && part.material ? 
          materialOptions.find(m => m.value === part.material)?.subtypes.find(s => s.value === part.materialSubtype)?.label || part.materialSubtype 
          : '';
        
        const surfaceRoughnessLabel = part.surfaceRoughness ? 
          surfaceRoughnessOptions.find(o => o.value === part.surfaceRoughness)?.label || part.surfaceRoughness 
          : '';
        
        const toleranceLabel = part.tolerance ? 
          toleranceOptions.find(o => o.value === part.tolerance)?.label || part.tolerance 
          : '';
        
        const surfaceTreatmentLabel = part.surfaceTreatment ? 
          part.surfaceTreatment === 'other' 
            ? `Other - ${part.surfaceTreatmentOther}` 
            : part.surfaceTreatment === 'none'
              ? ''  // Empty string for display when "none" is selected
              : surfaceTreatmentOptions.find(o => o.value === part.surfaceTreatment)?.label || part.surfaceTreatment 
          : '';

        return {
          id: crypto.randomUUID(),
          rfq_id: '', // Will be filled in after RFQ creation
          product_name: `Part ${index + 1}`,
          description: `Process: ${processLabel}
Material: ${materialLabel}${materialSubtypeLabel ? ` (${materialSubtypeLabel})` : ''}
${surfaceRoughnessLabel ? `Surface Roughness: ${surfaceRoughnessLabel}` : ''}
${surfaceTreatmentLabel ? `Surface Treatment: ${surfaceTreatmentLabel}` : ''}
${toleranceLabel ? `Tolerance: ${toleranceLabel}` : ''}
${part.thickness ? `Thickness: ${part.thickness} mm` : ''}
${part.needsBending ? `Bending: Yes` : ''}
${part.documentation ? `Documentation: ${part.documentation}` : ''}
${part.comments ? `Comments: ${part.comments}` : ''}`,
          quantity: part.quantity * (part.multiplier || 1),
          unit_price: 0, // Will be filled in later
          total_price: 0, // Will be filled in later
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Save the original values for future reference
          original_values: {
            process: part.process,
            processLabel,
            material: part.material,
            materialLabel,
            materialSubtype: part.materialSubtype,
            materialSubtypeLabel,
            surfaceRoughness: part.surfaceRoughness,
            surfaceRoughnessLabel,
            surfaceTreatment: part.surfaceTreatment,
            surfaceTreatmentLabel,
            tolerance: part.tolerance,
            toleranceLabel,
            documentation: part.documentation,
            comments: part.comments,
            thickness: part.thickness,
            needsBending: part.needsBending,
          }
        };
      });

      // Create RFQ record in Supabase
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
            customer_id: null,
            status: isOrder ? 'approved' : 'draft',
            currency: 'EUR',
            due_date: values.delivery.maxDeliveryDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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

      console.log('RFQ created:', rfqData);

      // Update parts with the correct rfq_id
      const updatedPartsDetails = partsDetails.map((part, index) => ({
        ...part,
        rfq_id: rfqData.id,
        product_name: `Part ${index + 1} ${rfqNumber}-${index + 1}`
      }));

      // Update the RFQ with the correct rfq_id in parts_details
      const { error: updateError } = await supabase
        .from('rfqs')
        .update({ 
          parts_details: updatedPartsDetails 
        } as any)
        .eq('id', rfqData.id);

      if (updateError) {
        console.error('Error updating RFQ parts:', updateError);
        throw updateError;
      }

      // Upload files to S3 and save references in Supabase
      for (let i = 0; i < values.parts.length; i++) {
        const part = values.parts[i];
        // Get the part ID from the updated parts details using type assertion
        const partId = (updatedPartsDetails[i] as any).id;
        
        if (part.files && part.files.length > 0) {
          for (const file of part.files) {
            try {
              console.log(`Uploading file for part: ${file.name}`);
              // Use a cleaner folder structure for S3
              // Format: RFQ-NUMBER/part-Part-NAME/filename
              const partFolderName = `part-${part.name.replace(/\s+/g, '-')}`;
              const filePath = await uploadFileToS3(file, `${rfqNumber}/${partFolderName}`);
              
              if (filePath) {
                try {
                  // Now we have the part_id column, so we can use it
                  const { error: fileError } = await supabase
                    .from('rfq_files')
                    .insert({
                      rfq_id: rfqData.id,
                      part_id: partId,
                      file_name: file.name,
                      file_path: filePath,
                      file_type: file.type,
                      file_size: file.size
                    });

                  if (fileError) {
                    // If error is about missing part_id column, try without it
                    if (fileError.message && fileError.message.includes('part_id')) {
                      console.warn('part_id column not found, saving file without part association:', fileError);
                      const { error: retryError } = await supabase
                        .from('rfq_files')
                        .insert({
                          rfq_id: rfqData.id,
                          file_name: file.name,
                          file_path: filePath,
                          file_type: file.type,
                          file_size: file.size
                        });

                      if (retryError) {
                        console.error('Error saving file reference (second attempt):', retryError);
                      }
                    } else {
                      console.error('Error saving file reference:', fileError);
                    }
                  } else {
                    console.log('File uploaded and associated with part:', partId);
                  }
                } catch (err) {
                  console.error('Error saving file reference:', err);
                }
              }
            } catch (err) {
              console.error('Error uploading file:', err);
            }
          }
        }
      }

      // If this is a direct order, also create a record in the orders table
      if (isOrder) {
        const { error: orderError } = await supabase
          .from('orders')
          .insert([
            {
              customer_id: null,
              rfq_id: rfqData.id,
              status: 'new',
              total_amount: 0,
              currency: 'EUR',
              title: `${rfqNumber} - ${values.companyName}`,
              start_date: new Date().toISOString(),
              delivery_date: values.delivery.maxDeliveryDate || null,
            }
          ]);

        if (orderError) {
          console.error('Error creating order:', orderError);
          throw orderError;
        }
        console.log('Order record created for RFQ:', rfqData.id);
      }

      // Send confirmation and notification emails
      try {
        console.log('Sending RFQ confirmation and notification emails...');
        const emailResult = await sendRFQEmails({
          customerName: `${values.contact.firstName} ${values.contact.lastName}`,
          customerEmail: values.contact.email,
          companyName: values.companyName,
          rfqNumber: rfqNumber,
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

      // Track the quote request submission
      trackQuoteRequest({
        value: 0, // No value available at this stage
        currency: 'EUR',
        partCount: values.parts.length,
        industry: 'general' // Could be enhanced to track actual industry
      });

      // Track form submission success
      trackFormSubmission('quote_request_form', true);

      // Track Google Ads conversion for form submission success
      trackQuoteFormSubmitSuccess({
        part_count: values.parts.length,
      });

      // Show success message
      toast({
        title: "Success",
        description: "Your quote request has been submitted successfully. We will contact you shortly.",
      });

      // Redirect after successful submission
      if (isOrder) {
        console.log('Redirecting to orders tab...');
        navigate(getLocalizedPath('/customer/projects?tab=orders'));
      } else {
        console.log('Redirecting to customer projects...');
        navigate(getLocalizedPath('/customer/projects'));
      }

    } catch (error) {
      console.error('Submission error:', error);
      
      // Track form submission error
      trackFormSubmission('quote_request_form', false);
      
      if (error instanceof Yup.ValidationError) {
        console.log('Validation error details:', error.inner);
        const errors = error.inner.reduce((acc, err) => {
          if (err.path) {
            acc[err.path] = err.message;
          }
          return acc;
        }, {} as Record<string, string>);

        setErrors(errors);
        setTouched(Object.keys(errors).reduce((acc, key) => {
          acc[key] = true;
          return acc;
        }, {} as Record<string, boolean>));

        toast({
          title: "Validation Error",
          description: "Please check all form fields and try again",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Error",
          description: "There was an error submitting your request. Please try again.",
          variant: "destructive"
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">{t('quote_form_request_quote')}</h2>
        <div className="flex items-center justify-between mb-6">
          {steps.map((step, index) => (
            <React.Fragment key={index}>
              <div className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    index === currentStep
                      ? 'bg-teal-600 text-white'
                      : index < currentStep
                      ? 'bg-teal-100 text-teal-600'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {index + 1}
                </div>
                <span
                  className={`ml-2 ${
                    index === currentStep
                      ? 'text-teal-600 font-medium'
                      : index < currentStep
                      ? 'text-teal-600'
                      : 'text-gray-400'
                  }`}
                >
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-4 ${
                    index < currentStep ? 'bg-teal-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <Formik
        initialValues={prefillValues ? { ...initialValues, ...prefillValues } : initialValues}
        validationSchema={validationSchemas[currentStep]}
        onSubmit={handleSubmit}
        validateOnBlur={true}
        validateOnChange={true}
        enableReinitialize={true}
      >
        {(formikProps) => {
          const { values, errors, touched, setErrors, setTouched, handleChange, handleBlur, setFieldValue, validateForm, isSubmitting, submitForm } = formikProps;
          
          console.log('Formik render - current step:', currentStep);
          console.log('Formik values:', values);
          console.log('Formik errors:', errors);
          console.log('Formik touched:', touched);
          
          return (
            <Form className="space-y-6">
              {React.createElement(steps[currentStep].component, {
                formikProps: {
                  ...formikProps,
                  setFieldValue,
                  validateForm,
                  submitForm,
                  isSubmitting,
                },
              })}

              <div className="flex justify-between pt-6">
                {currentStep > (skipCompanyStep ? 1 : 0) && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                  >
                    {t('quote_form_back')}
                  </Button>
                )}
                <div className="flex-1" />
                {currentStep < steps.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() => handleNext(values, setErrors, setTouched)}
                  >
                    {t('quote_form_next')}
                  </Button>
                ) : null}
              </div>
            </Form>
          );
        }}
      </Formik>
    </div>
  );
};

export default MultiStepQuoteForm;
