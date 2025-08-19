import React from 'react';
import { Check } from 'lucide-react';
import { StepComponentProps } from '../types';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const StepReviewSubmit: React.FC<StepComponentProps> = ({ formikProps }) => {
  const { values, errors, touched, setFieldValue, isSubmitting, submitForm } = formikProps;
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  
  console.log('StepReviewSubmit render - values:', values);
  console.log('StepReviewSubmit render - isSubmitting:', isSubmitting);
  console.log('StepReviewSubmit render - errors:', errors);
  
  // Get all files from all parts
  const allFiles = values.parts.reduce((files: any[], part: any) => {
    return [...files, ...(part.files || [])];
  }, []);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Submit button clicked');
    console.log('Current form values:', values);
    console.log('Terms accepted:', values.termsAccepted);
    
    if (!values.termsAccepted) {
      console.log('Terms not accepted, preventing submission');
      setFieldValue('termsAccepted', false);
      return;
    }
    
    console.log('Triggering form submission...');
    submitForm();
  };
  
  return (
    <div className="space-y-8">
      <h3 className="text-xl font-medium mb-6">{t('quote_form_review_submit_title')}</h3>
      
      <div className="space-y-6">
        <div className="bg-gray-50 p-5 rounded-lg">
          <h4 className="font-medium mb-3">{t('quote_form_company_information')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">{t('quote_form_company_name')}</p>
              <p className="font-medium">{values.companyName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('quote_form_vat_tax_id')}</p>
              <p className="font-medium">{values.vatId}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-gray-50 p-5 rounded-lg">
          <h4 className="font-medium mb-3">{t('quote_form_address')}</h4>
          <p className="font-medium">{values.address?.street}</p>
          <p className="font-medium">
            {values.address?.city}, {values.address?.zipCode}
          </p>
          <p className="font-medium">{values.address?.country}</p>
        </div>
        
        <div className="bg-gray-50 p-5 rounded-lg">
          <h4 className="font-medium mb-3">{t('quote_form_contact_person')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">{t('quote_form_name')}</p>
              <p className="font-medium">{values.contact?.firstName} {values.contact?.lastName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('quote_form_position')}</p>
              <p className="font-medium">{values.contact?.position || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('quote_form_email')}</p>
              <p className="font-medium">{values.contact?.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('quote_form_phone')}</p>
              <p className="font-medium">{values.contact?.phone}</p>
            </div>
            {values.contact?.mobile && (
              <div>
                <p className="text-sm text-gray-500">{t('quote_form_mobile')}</p>
                <p className="font-medium">{values.contact?.mobile}</p>
              </div>
            )}
          </div>
        </div>
        
        {allFiles.length > 0 && (
          <div className="bg-gray-50 p-5 rounded-lg">
            <h4 className="font-medium mb-3">{t('quote_form_files')}</h4>
            <p className="font-medium">{allFiles.length} {t('quote_form_files_uploaded_count')}</p>
            <ul className="list-disc list-inside text-sm text-gray-600">
              {allFiles.map((file: any, index: number) => (
                <li key={index}>{file.name}</li>
              ))}
            </ul>
          </div>
        )}
        
        <div className="bg-gray-50 p-5 rounded-lg">
          <h4 className="font-medium mb-3">{t('quote_form_parts')}</h4>
          {values.parts.map((part: any, index: number) => (
            <div key={index} className="border border-gray-200 rounded-md p-4 mb-4 last:mb-0">
              <h5 className="font-medium text-lg mb-2">{part.name} - Qty: {part.quantity}</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-600">{t('quote_form_process')}</p>
                  <p className="font-medium">{part.process || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-600">{t('quote_form_material')}</p>
                  <p className="font-medium">{part.material || '-'}{part.materialSubtype ? ` (${part.materialSubtype})` : ''}</p>
                </div>
                <div>
                  <p className="text-gray-600">{t('quote_form_surface_roughness')}</p>
                  <p className="font-medium">{part.surfaceRoughness || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-600">{t('quote_form_surface_treatment')}</p>
                  <p className="font-medium">{part.surfaceTreatment && part.surfaceTreatment !== 'none' ? 
                    (part.surfaceTreatment === 'other' ? `Other - ${part.surfaceTreatmentOther}` : part.surfaceTreatment) 
                    : '-'}</p>
                </div>
                <div>
                  <p className="text-gray-600">{t('quote_form_tolerance')}</p>
                  <p className="font-medium">{part.tolerance || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-600">{t('quote_form_documentation')}</p>
                  <p className="font-medium">{part.documentation || '-'}</p>
                </div>
                {part.comments && (
                  <div className="col-span-2">
                    <p className="text-gray-600">{t('quote_form_comments')}</p>
                    <p className="font-medium">{part.comments}</p>
                  </div>
                )}
                {part.files && part.files.length > 0 && (
                  <div className="col-span-2">
                    <p className="text-gray-600">{t('quote_form_files')} ({part.files.length}):</p>
                    <ul className="list-disc list-inside">
                      {part.files.map((file: any, fileIndex: number) => (
                        <li key={fileIndex} className="text-gray-800">{file.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        <div className="bg-gray-50 p-5 rounded-lg">
          <h4 className="font-medium mb-3">{t('quote_form_delivery_information')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600 text-sm">{t('quote_form_delivery_speed')}</p>
              <p className="font-medium">{values.delivery?.speed || 'Standard'}</p>
            </div>
            {values.delivery?.maxDeliveryDate && (
              <div>
                <p className="text-gray-600 text-sm">{t('quote_form_delivery_needed_by')}</p>
                <p className="font-medium">{new Date(values.delivery.maxDeliveryDate).toLocaleDateString()}</p>
              </div>
            )}
            {values.delivery?.latestOfferDate && (
              <div>
                <p className="text-gray-600 text-sm">{t('quote_form_quote_needed_by')}</p>
                <p className="font-medium">{new Date(values.delivery.latestOfferDate).toLocaleDateString()}</p>
              </div>
            )}
          </div>
          {values.generalNotes && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-gray-600 text-sm">{t('quote_form_general_notes')}</p>
              <p className="font-medium whitespace-pre-line">{values.generalNotes}</p>
            </div>
          )}
          {values.internalRequestNumber && (
            <div className="mt-3">
              <p className="text-gray-600 text-sm">{t('quote_form_internal_request_number')}</p>
              <p className="font-medium">{values.internalRequestNumber}</p>
            </div>
          )}
        </div>
      </div>
      
      <div className="space-y-4 pt-6 border-t border-gray-200">
        <div className="flex items-start space-x-2">
          <Checkbox 
            id="termsAccepted" 
            checked={values.termsAccepted} 
            onCheckedChange={(checked) => {
              console.log('Terms checkbox changed:', checked);
              setFieldValue('termsAccepted', checked);
            }}
          />
          <div>
            <Label htmlFor="termsAccepted" className="text-sm text-gray-900">
              {t('quote_form_terms_conditions')} <a href={getLocalizedPath('/terms')} className="text-teal-600 hover:underline">{t('quote_form_terms_conditions_link')}</a> {t('quote_form_and')} <a href={getLocalizedPath('/privacy')} className="text-teal-600 hover:underline">{t('quote_form_privacy_policy')}</a> {t('quote_form_accept_contact')}
            </Label>
            {touched.termsAccepted && errors.termsAccepted && (
              <p className="text-red-500 text-sm mt-1">{String(errors.termsAccepted)}</p>
            )}
          </div>
        </div>
        
        <Button 
          type="submit" 
          onClick={handleSubmit}
          disabled={isSubmitting || !values.termsAccepted}
          className="w-full"
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
              {t('quote_form_processing')}
            </>
          ) : (
            t('quote_form_submit')
          )}
        </Button>
      </div>
    </div>
  );
};

export default StepReviewSubmit;
