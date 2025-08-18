import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Globe } from 'lucide-react';

const LanguageSwitcher: React.FC = () => {
  const { currentLanguage, setLanguage, supportedLanguages } = useLanguage();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    setIsOpen(false);
  };

  const currentLangInfo = supportedLanguages[currentLanguage as keyof typeof supportedLanguages];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
        aria-label={t('navbar_language_switcher') || 'Language switcher'}
      >
        <Globe className="w-4 h-4" />
        <span>{currentLangInfo?.nativeName || currentLangInfo?.name}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50">
          <div className="py-1" role="menu">
            {Object.entries(supportedLanguages).map(([code, lang]) => (
              <button
                key={code}
                onClick={() => handleLanguageChange(code)}
                className={`${
                  code === currentLanguage
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100'
                } block w-full text-left px-4 py-2 text-sm transition-colors`}
                role="menuitem"
              >
                <div className="flex items-center justify-between">
                  <span>{lang.nativeName}</span>
                  {code === currentLanguage && (
                    <span className="text-blue-600">✓</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Backdrop to close dropdown when clicking outside */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default LanguageSwitcher;

