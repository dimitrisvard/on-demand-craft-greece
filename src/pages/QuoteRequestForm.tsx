import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const QuoteRequestForm = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="container-custom pt-20 pb-10 min-h-screen">
      <h1 className="text-3xl font-bold mb-6">{t('quote_request_form_title')}</h1>
      
      <div className="bg-white shadow-md rounded-lg p-6">
        <p className="text-gray-600 mb-6">
          {t('quote_request_form_message')}
        </p>
        
        <div className="flex space-x-4">
          <Button 
            onClick={() => navigate(getLocalizedPath('/quote'))}
            className="bg-brand-primary hover:bg-brand-primary/90"
          >
            {t('quote_request_form_full_form')}
          </Button>
          
          <Button 
            onClick={() => navigate(getLocalizedPath('/'))}
            variant="outline"
          >
            {t('quote_request_form_back_home')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default QuoteRequestForm;
