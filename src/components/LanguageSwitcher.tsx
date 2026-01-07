import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Globe } from 'lucide-react';

const LanguageSwitcher: React.FC = () => {
  const { currentLanguage, setLanguage, supportedLanguages } = useLanguage();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    setIsOpen(false);
  };

  const currentLangInfo = supportedLanguages[currentLanguage as keyof typeof supportedLanguages];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        buttonRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative w-full sm:w-auto">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center sm:justify-start space-x-2 px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors w-full sm:w-auto"
        aria-label={t('navbar_language_switcher') || 'Language switcher'}
        aria-expanded={isOpen}
      >
        <Globe className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">{currentLangInfo?.nativeName || currentLangInfo?.name}</span>
        <ChevronDown className={`w-4 h-4 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop for mobile */}
          <div
            className="fixed inset-0 z-[45] bg-black/20 sm:hidden"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div 
            ref={dropdownRef}
            className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-full sm:w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-[50] max-h-[300px] overflow-y-auto"
            role="menu"
          >
            <div className="py-1">
              {Object.entries(supportedLanguages).map(([code, lang]) => (
                <button
                  key={code}
                  onClick={() => handleLanguageChange(code)}
                  className={`${
                    code === currentLanguage
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  } block w-full text-left px-4 py-2.5 text-sm transition-colors`}
                  role="menuitem"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{lang.nativeName}</span>
                    {code === currentLanguage && (
                      <span className="text-blue-600 ml-2 flex-shrink-0">✓</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default LanguageSwitcher;

