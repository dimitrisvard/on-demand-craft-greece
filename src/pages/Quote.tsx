import { Box } from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';
import MultiStepQuoteForm from '../components/quote-form/MultiStepQuoteForm';
import { useTranslation } from 'react-i18next';

const Quote = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen pt-16">
      {/* Hero Section */}
      <section className="relative py-20 bg-gray-900">
        <div className="absolute inset-0 bg-cover bg-center opacity-50" style={{ 
          backgroundImage: "url('/lovable-uploads/40169af5-c5dc-4a9d-928a-d3a9d7a7fec9.png')",
        }} />
        
        <div className="container-custom relative z-10 text-white">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              {t('quote_page_title')}
            </h1>
            <p className="text-lg md:text-xl mb-8 text-white/90">
              {t('quote_page_subtitle')}
            </p>
          </div>
        </div>
      </section>

      {/* Quote Form Section */}
      <section className="py-10 bg-gray-50">
        <div className="container-custom max-w-7xl">
          <MultiStepQuoteForm />
        </div>
      </section>
      
      {/* FAQs */}
      <section className="py-16 bg-white">
        <div className="container-custom max-w-6xl">
          <h2 className="text-3xl font-bold mb-12 text-center">{t('quote_page_faq_title')}</h2>
          
          <div className="space-y-6">
            {[
              {
                question: t('quote_page_faq_file_formats_question'),
                answer: t('quote_page_faq_file_formats_answer')
              },
              {
                question: t('quote_page_faq_manufacturing_time_question'),
                answer: t('quote_page_faq_manufacturing_time_answer')
              },
              {
                question: t('quote_page_faq_quote_info_question'),
                answer: t('quote_page_faq_quote_info_answer')
              },
              {
                question: t('quote_page_faq_min_order_question'),
                answer: t('quote_page_faq_min_order_answer')
              },
              {
                question: t('quote_page_faq_manufacturing_method_question'),
                answer: t('quote_page_faq_manufacturing_method_answer')
              },
            ].map((faq, index) => (
              <div key={index} className="bg-white rounded-lg p-6 shadow-md border border-gray-100">
                <h3 className="text-xl font-bold mb-3">{faq.question}</h3>
                <p className="text-gray-600">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      
      <Toaster />
    </div>
  );
};

export default Quote;
