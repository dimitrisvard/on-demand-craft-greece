import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const CTASection = () => {
  const { t, i18n } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  console.log('CTASection rendered, lang:', i18n.language);
  return (
    <section className="bg-brand-primary py-16 md:py-20">
      <div className="container-custom text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
          {t('cta_title', 'Ready to Start Your Manufacturing Project?')}
        </h2>
        <p className="text-white/90 max-w-2xl mx-auto mb-8 text-lg">
          {t('cta_subtitle', 'Upload your CAD files today and get a detailed quote within 24 hours. Our team of experts is ready to bring your designs to life with precision and quality.')}
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link to={getLocalizedPath('/quote')} className="btn-secondary bg-white text-brand-dark hover:bg-white/90 flex items-center justify-center">
            {t('cta_get_quote', 'Get Quote')} <ArrowRight size={18} className="ml-2" />
          </Link>
          <Link to={getLocalizedPath('/contact')} className="btn-secondary bg-transparent text-white border-white hover:bg-white/10">
            {t('cta_contact_sales', 'Contact Sales Team')}
          </Link>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
