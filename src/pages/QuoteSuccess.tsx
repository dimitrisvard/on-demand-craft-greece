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

        {/* Success Message Box */}
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          
          <h2 className="text-2xl font-bold mb-4">{t('quote_success_title')}</h2>
          
          <p className="text-gray-600 mb-8">
            {t('quote_success_message')}
          </p>

          {/* What happens next section */}
          <div className="bg-blue-50 rounded-lg p-6 mb-8 text-left">
            <h3 className="text-lg font-semibold text-blue-900 mb-4">What happens next?</h3>
            <ul className="space-y-2 text-blue-800">
              <li className="flex items-start">
                <span className="text-blue-600 mr-2">•</span>
                Our team will review your inquiry
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-2">•</span>
                We'll respond within 24 hours
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-2">•</span>
                If urgent, call us directly at +30-697-00-77-401
              </li>
            </ul>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              variant="outline" 
              onClick={handleReturnHome}
              className="w-full sm:w-auto"
            >
              {t('quote_sucess_return_home')}
            </Button>
            
            <Button 
              onClick={handleSubmitAnother}
              className="w-full sm:w-auto"
            >
              {t('quote_sucess_submit_another')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuoteSuccess; 