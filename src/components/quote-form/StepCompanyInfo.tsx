
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { countries } from './countries';
import { StepComponentProps } from './types';
import { get } from 'lodash';

const StepCompanyInfo: React.FC<StepComponentProps> = ({ formikProps }) => {
  const { values, errors, touched, handleChange, handleBlur, setFieldValue } = formikProps;

  // Helper function to safely check if a nested field is touched
  const isTouched = (path: string) => get(touched, path);
  
  // Helper function to safely get the error for a nested field
  const getError = (path: string) => get(errors, path);

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h3 className="text-xl font-medium mb-4">Company Information</h3>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="companyName">
              Company Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="companyName"
              name="companyName"
              value={values.companyName}
              onChange={handleChange}
              onBlur={handleBlur}
              className={touched.companyName && errors.companyName ? 'border-red-500' : ''}
            />
            {touched.companyName && errors.companyName && (
              <p className="text-red-500 text-sm mt-1">{errors.companyName as string}</p>
            )}
          </div>

          <div>
            <Label htmlFor="vatId">
              VAT/Tax ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="vatId"
              name="vatId"
              value={values.vatId}
              onChange={handleChange}
              onBlur={handleBlur}
              className={touched.vatId && errors.vatId ? 'border-red-500' : ''}
            />
            {touched.vatId && errors.vatId && (
              <p className="text-red-500 text-sm mt-1">{errors.vatId as string}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-xl font-medium mb-4">Company Address</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="address.street">
              Street Address <span className="text-red-500">*</span>
            </Label>
            <Input
              id="address.street"
              name="address.street"
              value={values.address?.street || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={isTouched('address.street') && getError('address.street') ? 'border-red-500' : ''}
            />
            {isTouched('address.street') && getError('address.street') && (
              <p className="text-red-500 text-sm mt-1">{getError('address.street') as string}</p>
            )}
          </div>

          <div>
            <Label htmlFor="address.city">
              City <span className="text-red-500">*</span>
            </Label>
            <Input
              id="address.city"
              name="address.city"
              value={values.address?.city || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={isTouched('address.city') && getError('address.city') ? 'border-red-500' : ''}
            />
            {isTouched('address.city') && getError('address.city') && (
              <p className="text-red-500 text-sm mt-1">{getError('address.city') as string}</p>
            )}
          </div>

          <div>
            <Label htmlFor="address.zipCode">
              ZIP/Postal Code <span className="text-red-500">*</span>
            </Label>
            <Input
              id="address.zipCode"
              name="address.zipCode"
              value={values.address?.zipCode || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={isTouched('address.zipCode') && getError('address.zipCode') ? 'border-red-500' : ''}
            />
            {isTouched('address.zipCode') && getError('address.zipCode') && (
              <p className="text-red-500 text-sm mt-1">{getError('address.zipCode') as string}</p>
            )}
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="address.country">
              Country <span className="text-red-500">*</span>
            </Label>
            <Select 
              name="address.country"
              value={values.address?.country || ''} 
              onValueChange={(value) => setFieldValue('address.country', value)}
            >
              <SelectTrigger className={isTouched('address.country') && getError('address.country') ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select a country" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((country) => (
                  <SelectItem key={country.code} value={country.name}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isTouched('address.country') && getError('address.country') && (
              <p className="text-red-500 text-sm mt-1">{getError('address.country') as string}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-xl font-medium mb-4">Contact Person</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="contact.firstName">
              First Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="contact.firstName"
              name="contact.firstName"
              value={values.contact?.firstName || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={isTouched('contact.firstName') && getError('contact.firstName') ? 'border-red-500' : ''}
            />
            {isTouched('contact.firstName') && getError('contact.firstName') && (
              <p className="text-red-500 text-sm mt-1">{getError('contact.firstName') as string}</p>
            )}
          </div>

          <div>
            <Label htmlFor="contact.lastName">
              Last Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="contact.lastName"
              name="contact.lastName"
              value={values.contact?.lastName || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={isTouched('contact.lastName') && getError('contact.lastName') ? 'border-red-500' : ''}
            />
            {isTouched('contact.lastName') && getError('contact.lastName') && (
              <p className="text-red-500 text-sm mt-1">{getError('contact.lastName') as string}</p>
            )}
          </div>

          <div>
            <Label htmlFor="contact.position">
              Position/Role
            </Label>
            <Input
              id="contact.position"
              name="contact.position"
              value={values.contact?.position || ''}
              onChange={handleChange}
              onBlur={handleBlur}
            />
            <p className="text-xs text-gray-500 mt-1">Optional</p>
          </div>

          <div>
            <Label htmlFor="contact.email">
              Email <span className="text-red-500">*</span>
            </Label>
            <Input
              id="contact.email"
              name="contact.email"
              type="email"
              value={values.contact?.email || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={isTouched('contact.email') && getError('contact.email') ? 'border-red-500' : ''}
            />
            {isTouched('contact.email') && getError('contact.email') && (
              <p className="text-red-500 text-sm mt-1">{getError('contact.email') as string}</p>
            )}
          </div>

          <div>
            <Label htmlFor="contact.phone">
              Phone Number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="contact.phone"
              name="contact.phone"
              type="tel"
              value={values.contact?.phone || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={isTouched('contact.phone') && getError('contact.phone') ? 'border-red-500' : ''}
            />
            {isTouched('contact.phone') && getError('contact.phone') && (
              <p className="text-red-500 text-sm mt-1">{getError('contact.phone') as string}</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              This contact information will be used to send your quote and for any follow-up communication.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepCompanyInfo;
