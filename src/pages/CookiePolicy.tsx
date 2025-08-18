import React from 'react';
import { useTranslation } from 'react-i18next';

const CookiePolicy = () => {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '2rem' }}>
      <h1>{t('cookie_policy_title')}</h1>
      <p>{t('cookie_policy_intro')}</p>
      <p>{t('cookie_policy_usage')}</p>
    </div>
  );
};

export default CookiePolicy; 