import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';

const ImpressumPage = () => {
  const { t } = useTranslation();

  // Extract URL from the EU dispute text and make it clickable
  const euDisputeText = t('impressum_eu_dispute_text');
  const urlMatch = euDisputeText.match(/https?:\/\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : 'https://ec.europa.eu/consumers/odr/';
  const textParts = euDisputeText.split(url);

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
              <p>Dimitrios Vardalachakis</p>
            </div>

            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_acting_under')}:</h3>
              <p>MICRONS HUB DV Ε.Ε.</p>
            </div>

            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_address')}:</h3>
              <p>Industrial Area Street B Number 4<br />71601 Heraklion<br />Griechenland</p>
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">{t('impressum_contact')}:</h3>
            <p>
              {t('impressum_phone', 'Phone')}: +302104447830<br />
              {t('impressum_email', 'E-Mail')}: <a href="mailto:info@micronshub.eu" className="text-brand-accent hover:underline">info@micronshub.eu</a>
            </p>
          </section>

          <section>
            <div className="mb-4">
              <h3 className="font-semibold">{t('impressum_legal_form')}:</h3>
              <p>{t('impressum_legal_form_detail')}</p>
            </div>

            <div className="mb-4">
               <h3 className="font-semibold">{t('impressum_register_entry')}:</h3>
               <p>{t('impressum_register_detail')}</p>
            </div>

            <div className="mb-4">
               <h3 className="font-semibold">{t('impressum_vat_id')}:</h3>
               <p>{t('impressum_vat_detail')}</p>
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">{t('impressum_eu_dispute')}</h3>
            <p>
              {textParts[0]}
              <a 
                href={url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-brand-accent hover:underline"
              >
                {url}
              </a>
              {textParts[1]}
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">{t('impressum_consumer_dispute')}</h3>
            <p>
              {t('impressum_consumer_dispute_text')}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ImpressumPage;

