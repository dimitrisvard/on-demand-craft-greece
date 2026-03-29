import { Toaster } from '@/components/ui/toaster';
import MultiStepQuoteForm from '@/components/quote-form/MultiStepQuoteForm';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

const CustomerQuotePage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isOrder = location.pathname.includes('/customer/order');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">
        {isOrder
          ? t('customer_order_page_title', 'Place an Order')
          : t('customer_quote_page_title', 'Request a Quote')}
      </h1>
      <MultiStepQuoteForm isOrder={isOrder} skipCompanyStep />
      <Toaster />
    </div>
  );
};

export default CustomerQuotePage;
