// Google Analytics 4 utility functions
declare global {
  interface Window {
    gtag: (...args: any[]) => void;
    dataLayer: any[];
  }
}

// Google Analytics measurement ID from environment variable
export const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || 'AW-17760727501';

// Initialize Google Analytics
export const initGA = () => {
  // GA is already initialized via the script tags in index.html
  // This function can be used for additional setup if needed
  if (typeof window !== 'undefined' && window.gtag) {
    console.log('Google Analytics initialized');
  }
};

// Track page views
export const trackPageView = (url: string, title?: string) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('config', GA_MEASUREMENT_ID, {
      page_title: title,
      page_location: url,
    });
    console.log('GA: Page view tracked', { url, title });
  }
};

// Track custom events
export const trackEvent = (action: string, category: string, label?: string, value?: number) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value,
    });
    console.log('GA: Event tracked', { action, category, label, value });
  }
};

// Track conversions (for quote requests, orders, etc.)
export const trackConversion = (eventName: string, parameters?: Record<string, any>) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, {
      send_to: GA_MEASUREMENT_ID,
      ...parameters,
    });
    console.log('GA: Conversion tracked', { eventName, parameters });
  }
};

// Track quote requests
export const trackQuoteRequest = (quoteData: {
  value?: number;
  currency?: string;
  partCount?: number;
  industry?: string;
}) => {
  trackConversion('quote_request', {
    currency: quoteData.currency || 'EUR',
    value: quoteData.value || 0,
    custom_parameters: {
      part_count: quoteData.partCount,
      industry: quoteData.industry,
    },
  });
};

// Track order placement
export const trackOrderPlacement = (orderData: {
  orderId: string;
  value: number;
  currency?: string;
  items?: any[];
}) => {
  trackConversion('purchase', {
    transaction_id: orderData.orderId,
    value: orderData.value,
    currency: orderData.currency || 'EUR',
    items: orderData.items,
  });
};

// Track file downloads
export const trackFileDownload = (fileName: string, fileType: string) => {
  trackEvent('file_download', 'engagement', `${fileName} (${fileType})`);
};

// Track form submissions
export const trackFormSubmission = (formName: string, success: boolean = true) => {
  trackEvent(success ? 'form_submit_success' : 'form_submit_error', 'form', formName);
};

// Track Google Ads conversion events
// This function implements the Google Ads measurement protocol for tracking conversions
// It sends events to Google Analytics which can be used for Google Ads conversion tracking
export const trackGoogleAdsConversion = (eventName: string, parameters?: Record<string, any>) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, {
      // Google Ads specific parameters
      send_to: GA_MEASUREMENT_ID,
      ...parameters,
    });
    console.log('Google Ads: Conversion tracked', { eventName, parameters });
  }
};

// Track quote form submission success event for Google Ads and analytics
export const trackQuoteFormSubmitSuccess = (parameters?: Record<string, any>) => {
  const eventParameters = {
    event_category: 'form',
    event_label: 'quote_request_form',
    value: 0,
    currency: 'EUR',
    ...parameters,
  };

  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'form_submit_success', eventParameters);
    console.log('GA: Quote form submit success event tracked', { eventParameters });
  }

  trackGoogleAdsConversion('form_submit_success', eventParameters);
};

// Track user interactions
export const trackUserInteraction = (action: string, element: string) => {
  trackEvent(action, 'user_interaction', element);
};
