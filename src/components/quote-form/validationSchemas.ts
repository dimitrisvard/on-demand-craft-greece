import * as Yup from 'yup';

export const validationSchemas = [
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
      position: Yup.string().required('Position is required'),
      email: Yup.string()
        .email('Invalid email address')
        .required('Email is required'),
      phone: Yup.string().required('Phone number is required'),
    }),
  }),

  // Step 2: Part Details & Files
  Yup.object().shape({
    parts: Yup.array().of(
      Yup.object().shape({
        name: Yup.string().required('Part name is required'),
        quantity: Yup.number()
          .min(1, 'Quantity must be at least 1')
          .required('Quantity is required'),
        process: Yup.string().required('Manufacturing process is required'),
        material: Yup.string().required('Material is required'),
        surfaceTreatment: Yup.string().required('Surface treatment is required'),
        files: Yup.array()
          .min(1, 'At least one file is required for each part')
          .required('Files are required'),
      })
    ).min(1, 'At least one part is required'),
  }),

  // Step 3: Delivery Options
  Yup.object().shape({
    delivery: Yup.object().shape({
      speed: Yup.string().required('Delivery speed is required'),
      maxDeliveryDate: Yup.string().required('Maximum delivery date is required'),
      latestOfferDate: Yup.string().required('Latest offer date is required'),
    }),
  }),

  // Step 4: Review & Submit
  Yup.object().shape({
    confirmEmail: Yup.string()
      .email('Invalid email address')
      .required('Email confirmation is required'),
    termsAccepted: Yup.boolean()
      .oneOf([true], 'You must accept the terms and conditions')
      .required('You must accept the terms and conditions'),
    captchaToken: Yup.string().required('Please complete the captcha'),
  }),
]; 