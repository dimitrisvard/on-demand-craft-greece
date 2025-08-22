import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import { trackQuoteRequest, trackUserInteraction } from '@/utils/analytics';

const QuoteSuccess = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    // Track successful quote submission
    trackQuoteRequest({
      value: 0, // We don't have the quote value here
      currency: 'EUR',
      partCount: 1, // We don't have the exact part count here
      industry: 'general'
    });
  }, []);

  const handleReturnHome = () => {
    trackUserInteraction('click', 'quote_success_return_home');
    navigate(getLocalizedPath('/'));
  };

  const handleSubmitAnother = () => {
    trackUserInteraction('click', 'quote_success_submit_another');
    navigate(getLocalizedPath('/quote'));
  };

  return (
    <div className="min-h-screen pt-20 pb-10">
      <div className="container-custom max-w-2xl">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          
          <h1 className="text-2xl font-bold mb-4">{t('quote_success_title')}</h1>
          
          <p className="text-gray-600 mb-8">
            {t('quote_success_message')}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              variant="outline" 
              onClick={handleReturnHome}
              className="w-full sm:w-auto"
            >
              {t('quote_success_return_home')}
            </Button>
            
            <Button 
              onClick={handleSubmitAnother}
              className="w-full sm:w-auto"
            >
              {t('quote_success_submit_another')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuoteSuccess; 