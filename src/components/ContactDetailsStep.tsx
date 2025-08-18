
import React, { useState, useEffect } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';

interface ContactDetailsStepProps {
  email: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  businessUse: boolean;
  updateFormState: (field: string, value: any) => void;
  validateStep?: () => boolean;
}

const ContactDetailsStep: React.FC<ContactDetailsStepProps> = ({
  email,
  termsAccepted,
  privacyAccepted,
  businessUse,
  updateFormState,
  validateStep
}) => {
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [hasAttemptedNext, setHasAttemptedNext] = useState(false);
  const { toast } = useToast();
  
  const validateEmail = (email: string): boolean => {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
  };

  const handleCheckEmail = () => {
    if (!email) {
      setEmailError('Email is required');
      return;
    }
    
    if (!validateEmail(email)) {
      setEmailError('Please enter a valid email address');
      setEmailVerified(false);
      return;
    }
    
    setEmailError('');
    setEmailVerified(true);
    // Simulate email verification
    toast({
      title: "Email verified",
      description: "Your email has been validated successfully.",
      duration: 3000,
    });
  };

  useEffect(() => {
    // Provide validation function to parent component
    if (validateStep) {
      updateFormState('validateContactStep', () => {
        setHasAttemptedNext(true);
        
        if (!email) {
          setEmailError('Email is required');
          toast({
            title: "Error",
            description: "Please enter your email address",
            variant: "destructive",
          });
          return false;
        }
        
        if (!validateEmail(email)) {
          setEmailError('Please enter a valid email address');
          toast({
            title: "Error",
            description: "Please enter a valid email address",
            variant: "destructive",
          });
          return false;
        }
        
        if (!termsAccepted || !privacyAccepted || !businessUse) {
          toast({
            title: "Error",
            description: "Please accept all required terms to proceed",
            variant: "destructive",
          });
          return false;
        }
        
        return true;
      });
    }
  }, [email, termsAccepted, privacyAccepted, businessUse, validateStep, updateFormState, toast]);

  return (
    <div>
      <h3 className="text-xl font-bold mb-6">Contact Details</h3>
      
      <div className="mb-8">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Email address <span className="text-red-500">*</span>
        </label>
        <div className="flex">
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              updateFormState('contactEmail', e.target.value);
              setEmailVerified(false);
              if (hasAttemptedNext) {
                if (!e.target.value) {
                  setEmailError('Email is required');
                } else if (!validateEmail(e.target.value)) {
                  setEmailError('Please enter a valid email address');
                } else {
                  setEmailError('');
                }
              }
            }}
            placeholder="Enter your email address"
            className={`rounded-r-none ${emailError ? 'border-red-500' : ''}`}
          />
          <button
            type="button"
            className={`px-4 flex items-center justify-center ${
              emailVerified 
                ? 'bg-green-600 text-white' 
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            } rounded-r-md`}
            onClick={handleCheckEmail}
          >
            {emailVerified ? <Check size={20} /> : 'Check'}
          </button>
        </div>
        
        {emailError && (
          <div className="mt-2 text-sm text-red-600 flex items-center">
            <AlertTriangle size={12} className="mr-1" />
            {emailError}
          </div>
        )}
        
        {emailVerified && (
          <div className="mt-2 text-sm text-teal-600">
            This email address is already in our customer database.
          </div>
        )}
        
        {emailVerified && (
          <div className="mt-4 flex items-center text-teal-600 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            View contact information
          </div>
        )}
      </div>
      
      <div className="space-y-6">
        <div className="flex items-start space-x-4">
          <div className="shrink-0">
            <div className={`w-10 h-5 rounded-full transition ${
              termsAccepted ? 'bg-teal-600' : 'bg-gray-300'
            } flex items-center p-1 cursor-pointer`} onClick={() => updateFormState('termsAccepted', !termsAccepted)}>
              <div className={`w-3 h-3 rounded-full bg-white transform transition ${
                termsAccepted ? 'translate-x-5' : ''
              }`}></div>
            </div>
          </div>
          <div className="pt-1">
            <label className="text-sm cursor-pointer flex items-start" onClick={() => updateFormState('termsAccepted', !termsAccepted)}>
              <span>
                I accept the <a href="#" className="text-teal-600 hover:underline">terms and conditions</a> <span className="text-red-500">*</span>
              </span>
            </label>
            {hasAttemptedNext && !termsAccepted && (
              <p className="text-xs text-red-500 mt-1">You must accept the terms and conditions</p>
            )}
          </div>
        </div>
        
        <div className="flex items-start space-x-4">
          <div className="shrink-0">
            <div className={`w-10 h-5 rounded-full transition ${
              privacyAccepted ? 'bg-teal-600' : 'bg-gray-300'
            } flex items-center p-1 cursor-pointer`} onClick={() => updateFormState('privacyAccepted', !privacyAccepted)}>
              <div className={`w-3 h-3 rounded-full bg-white transform transition ${
                privacyAccepted ? 'translate-x-5' : ''
              }`}></div>
            </div>
          </div>
          <div className="pt-1">
            <label className="text-sm cursor-pointer flex items-start" onClick={() => updateFormState('privacyAccepted', !privacyAccepted)}>
              <span>
                I agree to the storage and processing of my data in order to receive an offer. 
                (<a href="#" className="text-teal-600 hover:underline">Privacy policy</a>) <span className="text-red-500">*</span>
              </span>
            </label>
            {hasAttemptedNext && !privacyAccepted && (
              <p className="text-xs text-red-500 mt-1">You must agree to the privacy policy</p>
            )}
          </div>
        </div>
        
        <div className="flex items-start space-x-4">
          <div className="shrink-0">
            <div className={`w-10 h-5 rounded-full transition ${
              businessUse ? 'bg-teal-600' : 'bg-gray-300'
            } flex items-center p-1 cursor-pointer`} onClick={() => updateFormState('businessUse', !businessUse)}>
              <div className={`w-3 h-3 rounded-full bg-white transform transition ${
                businessUse ? 'translate-x-5' : ''
              }`}></div>
            </div>
          </div>
          <div className="pt-1">
            <label className="text-sm cursor-pointer flex items-start" onClick={() => updateFormState('businessUse', !businessUse)}>
              <span>
                I am not requesting as a private individual. <span className="text-red-500">*</span>
              </span>
            </label>
            {hasAttemptedNext && !businessUse && (
              <p className="text-xs text-red-500 mt-1">This field is required</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactDetailsStep;
