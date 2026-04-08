import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { countries } from '../countries';
import { StepComponentProps } from '../types';
import { get } from 'lodash';
import { useTranslation } from 'react-i18next';

const StepCompanyInfo: React.FC<StepComponentProps> = ({ formikProps }) => {
  const { values, errors, touched, handleChange, handleBlur, setFieldValue } = formikProps;
  const { t } = useTranslation();

  // Helper function to safely check if a nested field is touched
  const isTouched = (path: string) => {
    const result = get(touched, path);
    console.log(`isTouched(${path}):`, result);
    return result;
  };
  
  // Helper function to safely get the error for a nested field
  const getError = (path: string) => {
    const result = get(errors, path);
    console.log(`getError(${path}):`, result);
    return result;
  };

  // Helper function to check if a field has an error
  const hasError = (path: string) => {
    return isTouched(path) && getError(path);
  };

  // Helper function to get the error message
  const getErrorMessage = (path: string) => {
    const error = getError(path);
    return error ? String(error) : '';
  };

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h3 className="text-xl font-medium mb-4 text-slate-100">{t('quote_form_company_info_title')}</h3>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="companyName" className="text-slate-200">
              {t('quote_form_company_name')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="companyName"
              name="companyName"
              value={values.companyName}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('companyName') ? 'border-red-500' : ''}`}
            />
            {hasError('companyName') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('companyName')}</p>
            )}
          </div>

          <div>
            <Label htmlFor="vatId" className="text-slate-200">
              {t('quote_form_vat_tax_id')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="vatId"
              name="vatId"
              value={values.vatId}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('vatId') ? 'border-red-500' : ''}`}
            />
            {hasError('vatId') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('vatId')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-xl font-medium mb-4 text-slate-100">{t('quote_form_company_address_title')}</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="address.street" className="text-slate-200">
              {t('quote_form_street_address')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="address.street"
              name="address.street"
              value={values.address?.street || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('address.street') ? 'border-red-500' : ''}`}
            />
            {hasError('address.street') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('address.street')}</p>
            )}
          </div>

          <div>
            <Label htmlFor="address.city" className="text-slate-200">
              {t('quote_form_city')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="address.city"
              name="address.city"
              value={values.address?.city || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('address.city') ? 'border-red-500' : ''}`}
            />
            {hasError('address.city') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('address.city')}</p>
            )}
          </div>

          <div>
            <Label htmlFor="address.zipCode" className="text-slate-200">
              {t('quote_form_zip_postal_code')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="address.zipCode"
              name="address.zipCode"
              value={values.address?.zipCode || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('address.zipCode') ? 'border-red-500' : ''}`}
            />
            {hasError('address.zipCode') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('address.zipCode')}</p>
            )}
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="address.country" className="text-slate-200">
              {t('quote_form_country')} <span className="text-red-400">*</span>
            </Label>
            <Select
              name="address.country"
              value={values.address?.country || ''}
              onValueChange={(value) => setFieldValue('address.country', value)}
            >
              <SelectTrigger className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('address.country') ? 'border-red-500' : ''}`}>
                <SelectValue placeholder={t('quote_form_select_country')} />
              </SelectTrigger>
              <SelectContent>
                {countries.map((country) => (
                  <SelectItem key={country.code} value={country.name}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasError('address.country') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('address.country')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-xl font-medium mb-4 text-slate-100">{t('quote_form_contact_person_title')}</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="contact.firstName" className="text-slate-200">
              {t('quote_form_first_name')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="contact.firstName"
              name="contact.firstName"
              value={values.contact?.firstName || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('contact.firstName') ? 'border-red-500' : ''}`}
            />
            {hasError('contact.firstName') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('contact.firstName')}</p>
            )}
          </div>

          <div>
            <Label htmlFor="contact.lastName" className="text-slate-200">
              {t('quote_form_last_name')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="contact.lastName"
              name="contact.lastName"
              value={values.contact?.lastName || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('contact.lastName') ? 'border-red-500' : ''}`}
            />
            {hasError('contact.lastName') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('contact.lastName')}</p>
            )}
          </div>

          <div>
            <Label htmlFor="contact.position" className="text-slate-200">
              {t('quote_form_position')}
            </Label>
            <Input
              id="contact.position"
              name="contact.position"
              value={values.contact?.position || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className="bg-slate-900/50 border-slate-600 text-slate-200"
            />
          </div>

          <div>
            <Label htmlFor="contact.email" className="text-slate-200">
              {t('quote_form_email')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="contact.email"
              name="contact.email"
              type="email"
              value={values.contact?.email || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('contact.email') ? 'border-red-500' : ''}`}
            />
            {hasError('contact.email') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('contact.email')}</p>
            )}
          </div>

          <div>
            <Label htmlFor="contact.phone" className="text-slate-200">
              {t('quote_form_phone')} <span className="text-red-400">*</span>
            </Label>
            <Input
              id="contact.phone"
              name="contact.phone"
              type="tel"
              value={values.contact?.phone || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`bg-slate-900/50 border-slate-600 text-slate-200 ${hasError('contact.phone') ? 'border-red-500' : ''}`}
            />
            {hasError('contact.phone') && (
              <p className="text-red-500 text-sm mt-1">{getErrorMessage('contact.phone')}</p>
            )}
          </div>

          <div>
            <Label htmlFor="contact.mobile" className="text-slate-200">
              {t('quote_form_mobile')}
            </Label>
            <Input
              id="contact.mobile"
              name="contact.mobile"
              type="tel"
              value={values.contact?.mobile || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder={t('quote_form_mobile_placeholder')}
              className="bg-slate-900/50 border-slate-600 text-slate-200"
            />
          </div>
        </div>
      </div>

      <div className="bg-blue-500/10 border-l-4 border-blue-400 p-4 rounded">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-300">
              {t('quote_form_contact_info_message')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepCompanyInfo;
