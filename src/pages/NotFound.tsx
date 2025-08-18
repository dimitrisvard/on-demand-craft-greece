import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Home, ArrowRight } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const NotFound = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-lg">
        <h1 className="text-9xl font-bold text-brand-teal mb-4">404</h1>
        <p className="text-2xl text-gray-800 font-bold mb-4">{t('not_found_title')}</p>
        <p className="text-gray-600 mb-8">
          {t('not_found_message')}
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link to={getLocalizedPath('/')} className="btn-primary inline-flex items-center justify-center">
            <Home size={18} className="mr-2" /> {t('not_found_back_home')}
          </Link>
          <Link to={getLocalizedPath('/contact')} className="btn-secondary inline-flex items-center justify-center">
            {t('not_found_contact_support')} <ArrowRight size={18} className="ml-2" />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
