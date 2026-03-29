import { Toaster } from '@/components/ui/toaster';
import MultiStepQuoteForm from '@/components/quote-form/MultiStepQuoteForm';
import { useTranslation } from 'react-i18next';

const CustomerQuotePage = () => {
  const { t } = useTranslation();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">
        {t('customer_quote_page_title', 'Request a Quote')}
      </h1>
      <MultiStepQuoteForm />
      <Toaster />
    </div>
  );
};

export default CustomerQuotePage;
