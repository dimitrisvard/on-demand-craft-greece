import React, { useState } from 'react';
import { FormikProps } from 'formik';
import { FileText, AlertTriangle, Check, X, Edit } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { getErrorAsString } from './types';

interface StepReviewSubmitProps {
  formikProps: FormikProps<any>;
}

const StepReviewSubmit: React.FC<StepReviewSubmitProps> = ({ formikProps }) => {
  const { values, errors, touched, setFieldValue, handleChange, handleBlur } = formikProps;
  const [emailVerified, setEmailVerified] = useState(false);
  
  const formatDate = (dateString: string): string => {
    if (!dateString) return 'Not specified';
    
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const verifyEmail = () => {
    if (values.confirmEmail && values.confirmEmail === values.contact.email) {
      setEmailVerified(true);
    } else {
      setEmailVerified(false);
      setFieldValue('confirmEmail', '');
    }
  };

  return (
    <div className="space-y-8">
      <h3 className="text-xl font-medium mb-4">Review Your Quote Request</h3>
      
      <div className="border rounded-lg p-6">
        <div className="flex justify-between mb-4">
          <h4 className="text-lg font-medium">Company & Contact Information</h4>
          <Button 
            variant="ghost"
            size="sm"
            className="text-teal-600"
            onClick={() => formikProps.setValues({ ...values, currentStep: 1 })}
          >
            <Edit size={15} className="mr-1" /> Edit
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500">Company</p>
            <p>{values.companyName}</p>
            {values.vatId && <p className="text-sm text-gray-500">VAT/Tax ID: {values.vatId}</p>}
          </div>
          
          <div>
            <p className="text-sm font-medium text-gray-500">Address</p>
            <p>{values.address.street}</p>
            <p>{values.address.city}, {values.address.zipCode}</p>
            <p>{values.address.country}</p>
          </div>
          
          <div>
            <p className="text-sm font-medium text-gray-500">Contact Person</p>
            <p>{values.contact.firstName} {values.contact.lastName}</p>
            {values.contact.position && <p className="text-sm text-gray-500">Position: {values.contact.position}</p>}
          </div>
          
          <div>
            <p className="text-sm font-medium text-gray-500">Contact Details</p>
            <p>Email: {values.contact.email}</p>
            <p>Phone: {values.contact.phone}</p>
          </div>
        </div>
      </div>
      
      <div className="border rounded-lg p-6">
        <div className="flex justify-between mb-4">
          <h4 className="text-lg font-medium">Uploaded Files</h4>
          <Button 
            variant="ghost"
            size="sm"
            className="text-teal-600"
            onClick={() => formikProps.setValues({ ...values, currentStep: 2 })}
          >
            <Edit size={15} className="mr-1" /> Edit
          </Button>
        </div>
        
        {values.files.length > 0 ? (
          <div className="space-y-2">
            {values.files.map((file: File, index: number) => (
              <div key={index} className="flex items-center">
                <FileText className="text-teal-600 mr-2" size={16} />
                <span>{file.name}</span>
                <span className="ml-2 text-sm text-gray-500">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
              </div>
            ))}
            
            {values.additionalFiles && values.additionalFiles.length > 0 && (
              <>
                <p className="text-sm font-medium text-gray-500 mt-4">Additional Information Files:</p>
                {values.additionalFiles.map((file: File, index: number) => (
                  <div key={index} className="flex items-center">
                    <FileText className="text-teal-600 mr-2" size={16} />
                    <span>{file.name}</span>
                  </div>
                ))}
              </>
            )}
            
            {values.generalNotes && (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-500">General Notes:</p>
                <p className="bg-gray-50 p-2 rounded">{values.generalNotes}</p>
              </div>
            )}
            
            {values.internalRequestNumber && (
              <div className="mt-2">
                <p className="text-sm font-medium text-gray-500">Internal Request Number:</p>
                <p>{values.internalRequestNumber}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-red-500">No files uploaded.</div>
        )}
      </div>
      
      <div className="border rounded-lg p-6">
        <div className="flex justify-between mb-4">
          <h4 className="text-lg font-medium">Parts ({values.parts.length})</h4>
          <Button 
            variant="ghost"
            size="sm"
            className="text-teal-600"
            onClick={() => formikProps.setValues({ ...values, currentStep: 3 })}
          >
            <Edit size={15} className="mr-1" /> Edit
          </Button>
        </div>
        
        {values.parts.map((part: any, index: number) => (
          <div key={index} className="border-b last:border-b-0 pb-4 mb-4 last:pb-0 last:mb-0">
            <div className="flex justify-between">
              <h5 className="font-medium">
                {part.name} 
                <span className="ml-2 text-gray-500">
                  (Qty: {part.quantity}{part.multiplier > 1 ? ` × ${part.multiplier}` : ''})
                </span>
              </h5>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              <div>
                <p className="text-sm text-gray-600">Process: {part.process.replace('-', ' ')}</p>
                <p className="text-sm text-gray-600">
                  Material: {part.material} {part.materialSubtype && `(${part.materialSubtype})`}
                </p>
              </div>
              
              <div>
                {part.surfaceTreatment && (
                  <p className="text-sm text-gray-600">Surface Treatment: {part.surfaceTreatment}</p>
                )}
                {part.documentation && part.documentation !== 'none' && (
                  <p className="text-sm text-gray-600">Documentation: {part.documentation}</p>
                )}
              </div>
            </div>
            
            {part.comments && (
              <div className="mt-2">
                <p className="text-sm text-gray-600">Comments:</p>
                <p className="text-sm bg-gray-50 p-2 rounded">{part.comments}</p>
              </div>
            )}

            {part.files && part.files.length > 0 && (
              <div className="mt-2">
                <p className="text-sm text-gray-600">Part Files:</p>
                {part.files.map((file: File, fileIndex: number) => (
                  <div key={fileIndex} className="flex items-center text-sm">
                    <FileText className="text-teal-600 mr-1" size={14} />
                    <span>{file.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      
      <div className="border rounded-lg p-6">
        <div className="flex justify-between mb-4">
          <h4 className="text-lg font-medium">Delivery Options</h4>
          <Button 
            variant="ghost"
            size="sm"
            className="text-teal-600"
            onClick={() => formikProps.setValues({ ...values, currentStep: 4 })}
          >
            <Edit size={15} className="mr-1" /> Edit
          </Button>
        </div>
        
        <div>
          <p><span className="font-medium">Delivery Speed:</span> {values.delivery.speed || 'Not selected'}</p>
          
          {values.delivery.maxDeliveryDate && (
            <p className="mt-2"><span className="font-medium">Maximum Delivery Date:</span> {formatDate(values.delivery.maxDeliveryDate)}</p>
          )}
          
          {values.delivery.latestOfferDate && (
            <p className="mt-2"><span className="font-medium">Quote Required By:</span> {formatDate(values.delivery.latestOfferDate)}</p>
          )}
        </div>
      </div>
      
      <div className="border rounded-lg p-6">
        <h4 className="text-lg font-medium mb-4">Email Confirmation</h4>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="confirmEmail">
              Confirm your email address <span className="text-red-500">*</span>
            </Label>
            <div className="flex">
              <Input
                id="confirmEmail"
                name="confirmEmail"
                type="email"
                value={values.confirmEmail}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder="Re-enter your email address"
                className={`rounded-r-none ${touched.confirmEmail && errors.confirmEmail ? 'border-red-500' : ''}`}
              />
              <Button
                type="button"
                className={`rounded-l-none px-4 ${
                  emailVerified 
                    ? 'bg-green-600 hover:bg-green-700 text-white' 
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                }`}
                onClick={verifyEmail}
              >
                {emailVerified ? <Check size={18} /> : 'Verify'}
              </Button>
            </div>
            
            {touched.confirmEmail && errors.confirmEmail && (
              <p className="text-red-500 text-sm mt-1">{getErrorAsString(errors.confirmEmail)}</p>
            )}
            
            {emailVerified && (
              <p className="text-green-600 text-sm mt-1 flex items-center">
                <Check size={14} className="mr-1" /> Email verification successful
              </p>
            )}
          </div>
          
          <div className="flex items-top space-x-2 mt-4">
            <Checkbox 
              id="termsAccepted"
              checked={values.termsAccepted}
              onCheckedChange={(checked) => setFieldValue('termsAccepted', !!checked)}
            />
            <div className="grid gap-1.5 leading-none">
              <Label 
                htmlFor="termsAccepted" 
                className={`text-sm font-normal ${touched.termsAccepted && errors.termsAccepted ? 'text-red-500' : ''}`}
              >
                I agree to the <a href="#" className="text-teal-600 hover:underline">terms and conditions</a> <span className="text-red-500">*</span>
              </Label>
              {touched.termsAccepted && errors.termsAccepted && (
                <p className="text-red-500 text-xs">{getErrorAsString(errors.termsAccepted)}</p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <div className="bg-gray-100 p-4 rounded-md text-sm">
              <p className="font-medium mb-2">What happens next?</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Our team will review your request and prepare a detailed quote.</li>
                <li>You'll receive an email with your quote and next steps.</li>
                <li>Once accepted, production will begin based on your selected delivery option.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
      
      {Object.keys(errors).length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded flex items-start">
          <AlertTriangle className="text-red-500 mr-2 flex-shrink-0 mt-1" size={18} />
          <div>
            <p className="text-red-700 font-medium">Please correct the following errors:</p>
            <ul className="text-red-700 text-sm list-disc pl-5 mt-1">
              {errors.confirmEmail && <li>Email confirmation is required</li>}
              {errors.termsAccepted && <li>You must accept the terms and conditions</li>}
              {/* Add other common errors here */}
              {Object.keys(errors).length > 2 && <li>There are additional form errors to fix</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default StepReviewSubmit;
