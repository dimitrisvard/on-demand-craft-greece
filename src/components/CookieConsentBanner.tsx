import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const COOKIE_CONSENT_KEY = 'cookie_consent_choice';

const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 9999,
  background: '#222',
  color: '#f5f5f5',
  padding: '24px 16px 20px 16px',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 -2px 16px rgba(0,0,0,0.2)',
  fontFamily: 'system-ui, sans-serif',
  fontSize: '1rem',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: 4,
  border: '2px solid transparent',
  fontSize: '1rem',
  cursor: 'pointer',
  transition: 'background 0.2s, color 0.2s, border 0.2s',
  marginRight: 8,
};

const acceptStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#1976d2',
  color: '#fff',
  borderColor: '#1976d2',
};

const declineStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'transparent',
  color: '#fff',
  border: '2px solid #fff',
};

const linkStyle: React.CSSProperties = {
  color: '#90caf9',
  textDecoration: 'underline',
  fontWeight: 500,
  marginLeft: 8,
  transition: 'color 0.2s',
};

export const CookieConsentBanner: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const handleConsent = (choice: 'accepted' | 'declined') => {
    localStorage.setItem(COOKIE_CONSENT_KEY, choice);
    setVisible(false);
    if (choice === 'accepted') {
      // Dynamically load Google tag (gtag.js)
      const gaScript = document.createElement('script');
      gaScript.async = true;
      gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=AW-17760727501';
      document.head.appendChild(gaScript);
      gaScript.onload = function() {
        (window as any).dataLayer = (window as any).dataLayer || [];
        function gtag(){(window as any).dataLayer.push(arguments);}
        (window as any).gtag = gtag;
        (window as any).gtag('js', new Date());
        (window as any).gtag('config', 'AW-17760727501');
      };
    }
  };

  if (!visible) return null;

  return (
    <div style={bannerStyle} role="dialog" aria-modal="true" aria-label="Cookie consent banner">
      <div style={{ flex: '1 1 320px', marginRight: 24, minWidth: 220, maxWidth: 600 }}>
        {t('cookie_consent_message')}
        {' '}
        <Link to="/cookie-policy" style={linkStyle}>{t('cookie_policy_link')}</Link>
        {' '}{t('for_more_information', 'for more information.')}
      </div>
      <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
        <button style={acceptStyle} onClick={() => handleConsent('accepted')} autoFocus>{t('cookie_accept')}</button>
        <button style={declineStyle} onClick={() => handleConsent('declined')}>{t('cookie_decline')}</button>
      </div>
    </div>
  );
};

export default CookieConsentBanner; 