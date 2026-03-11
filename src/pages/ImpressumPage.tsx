import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import SEOMeta from '../components/SEOMeta';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface ImpressumTranslation {
  legal_form_detail: string;
  register_detail: string;
  vat_detail: string;
  eu_dispute_text: string;
  consumer_dispute_text: string;
}

interface ImpressumSettings {
  id: string;
  operator_name: string;
  company_name: string;
  address_street: string;
  address_zip_city: string;
  address_country: string;
  phone: string;
  email: string;
  translations: Record<string, ImpressumTranslation>;
}

const fetchImpressumSettings = async (): Promise<ImpressumSettings | null> => {
  const { data, error } = await supabase
    .from('impressum_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Failed to load impressum settings:', error);
    return null;
  }
  return data as ImpressumSettings | null;
};

const ImpressumPage = () => {
  const { t } = useTranslation();
  const { currentLanguage: language } = useLanguage();

  const { data: settings } = useQuery({
    queryKey: ['impressum_settings'],
    queryFn: fetchImpressumSettings,
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });

  // Resolve per-language translated fields:
  // 1. Try DB translations for current language
  // 2. Fall back to DB English translations
  // 3. Fall back to i18n translation keys
  const langTrans = settings?.translations?.[language] ?? settings?.translations?.['en'];

  const legalFormDetail = langTrans?.legal_form_detail ?? t('impressum_legal_form_detail');
  const registerDetail = langTrans?.register_detail ?? t('impressum_register_detail');
  const vatDetail = langTrans?.vat_detail ?? t('impressum_vat_detail');
  const euDisputeRaw = langTrans?.eu_dispute_text ?? t('impressum_eu_dispute_text');
  const consumerDisputeText = langTrans?.consumer_dispute_text ?? t('impressum_consumer_dispute_text');

  // Universal fields (with hardcoded defaults as fallback)
  const operatorName = settings?.operator_name ?? 'Dimitrios Vardalachakis';
  const companyName = settings?.company_name ?? 'MICRONS HUB DV Ε.Ε.';
  const addressStreet = settings?.address_street ?? 'Industrial Area Street B Number 4';
  const addressZipCity = settings?.address_zip_city ?? '71601 Heraklion';
  const addressCountry = settings?.address_country ?? 'Griechenland';
  const phone = settings?.phone ?? '+302104447830';
  const email = settings?.email ?? 'info@micronshub.eu';

  // Extract clickable URL from the EU dispute text
  const urlMatch = euDisputeRaw.match(/https?:\/\/[^\s]+/);
  const euUrl = urlMatch ? urlMatch[0] : 'https://ec.europa.eu/consumers/odr/';
  const euTextParts = euDisputeRaw.split(euUrl);

  return (
    <div className="min-h-screen pt-24 pb-16">
      <SEOMeta
        title={`${t('impressum_title')} | Microns Hub`}
        description={t('impressum_title')}
      />

      <div className="container-custom max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">{t('impressum_title')}</h1>

        <div className="space-y-8 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold mb-4">{t('impressum_section5')}</h2>

            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_operator')}:</h3>
              <p>{operatorName}</p>
            </div>

            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_acting_under')}:</h3>
              <p>{companyName}</p>
            </div>

            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_address')}:</h3>
              <p>
                {addressStreet}<br />
                {addressZipCity}<br />
                {addressCountry}
              </p>
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">{t('impressum_contact')}:</h3>
            <p>
              {t('impressum_phone', 'Phone')}: {phone}<br />
              {t('impressum_email', 'E-Mail')}:{' '}
              <a href={`mailto:${email}`} className="text-brand-accent hover:underline">
                {email}
              </a>
            </p>
          </section>

          <section>
            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_legal_form')}:</h3>
              <p>{legalFormDetail}</p>
            </div>

            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_register_entry')}:</h3>
              <p>{registerDetail}</p>
            </div>

            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_vat_id')}:</h3>
              <p>{vatDetail}</p>
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">{t('impressum_eu_dispute')}</h3>
            <p>
              {euTextParts[0]}
              <a
                href={euUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-accent hover:underline"
              >
                {euUrl}
              </a>
              {euTextParts[1]}
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">{t('impressum_consumer_dispute')}</h3>
            <p>{consumerDisputeText}</p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ImpressumPage;
