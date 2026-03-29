import { FormikErrors, FormikTouched, FormikProps } from 'formik';
import { ReactNode } from 'react';

export interface FormValues {
  // Step 1: Company & Contact Information
  companyName: string;
  vatId: string;
  address: {
    street: string;
    city: string;
    zipCode: string;
    country: string;
  };
  contact: {
    firstName: string;
    lastName: string;
    position: string;
    email: string;
    phone: string;
    mobile: string;
  };

  // Step 2: Part Details & Files
  parts: PartDetails[];
  generalNotes: string;
  internalRequestNumber: string;

  // Step 3: Delivery Options
  delivery: {
    speed: string;
    maxDeliveryDate: string;
    latestOfferDate: string;
  };

  // Step 4: Review & Submit
  termsAccepted: boolean;
  captchaToken: string;
}

export interface PartDetails {
  name: string;
  quantity: number;
  multiplier: number;
  files: File[];
  process: string;
  material: string;
  materialSubtype: string;
  surfaceTreatment: string;
  surfaceRoughness: string;
  tolerance: string;
  documentation: string;
  comments: string;
  userModifiedName: boolean;
  surfaceTreatmentOther: string;
  thickness: string;
  needsBending: boolean;
}

export interface StepComponentProps {
  formikProps: FormikProps<FormValues>;
}

// Helper function to safely convert FormikErrors to string
export const getErrorAsString = (error: string | string[] | FormikErrors<any> | FormikErrors<any>[] | undefined): ReactNode => {
  if (typeof error === 'string') {
    return error;
  }
  if (Array.isArray(error)) {
    return error[0] ? getErrorAsString(error[0]) : "";
  }
  if (error && typeof error === 'object') {
    return "Invalid value";
  }
  return "";
};
