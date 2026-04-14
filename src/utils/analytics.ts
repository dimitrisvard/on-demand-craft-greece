// Google Analytics 4 utility functions
declare global {
  interface Window {
    gtag: (...args: any[]) => void;
    dataLayer: any[];
  }
}

// Google Analytics measurement ID
// Hardcoded to ensure it works without env vars for now, can be moved back to env later if needed
export const GA_MEASUREMENT_ID = 'G-G6T5PMFLRH'; 
export const GOOGLE_ADS_ID = 'AW-17760727501';
// Google Ads Conversion Label for Quote Form Submission
// Get this from Google Ads > Goals > Conversions > [Your Conversion] > Tag Setup
export const GOOGLE_ADS_CONVERSION_LABEL = import.meta.env.VITE_GOOGLE_ADS_CONVERSION_LABEL || 'b9kmCO_6lcsbEM3j_JRC';

// Initialize Google Analytics
export const initGA = () => {
  if (typeof window === 'undefined') return;

  // Ensure dataLayer exists
  window.dataLayer = window.dataLayer || [];
  
  // Define gtag if it doesn't exist
  if (!window.gtag) {
    window.gtag = function() {
      window.dataLayer.push(arguments);
    };
  }

  // Script is loaded directly in index.html to track all visits
  console.log('Analytics utility initialized');
};

// Track page views
export const trackPageView = (url: string, title?: string) => {
  if (typeof window !== 'undefined' && window.gtag) {
    try {
      window.gtag('config', GA_MEASUREMENT_ID, {
        page_title: title,
        page_location: url,
      });
      console.log('GA: Page view tracked', { url, title, measurementId: GA_MEASUREMENT_ID });
    } catch (error) {
      console.error('GA: Error tracking page view', error);
    }
  } else {
    console.warn('GA: gtag not available for page view tracking', { 
      hasGtag: typeof window !== 'undefined' && !!window.gtag,
      url 
    });
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
    // Build the send_to parameter with conversion label if available
    let sendTo = GOOGLE_ADS_ID;
    if (GOOGLE_ADS_CONVERSION_LABEL) {
      // If label is provided, append it to the account ID
      sendTo = `${GOOGLE_ADS_ID}/${GOOGLE_ADS_CONVERSION_LABEL}`;
    }
    
    window.gtag('event', eventName, {
      // Google Ads specific parameters - send_to must include conversion label for proper tracking
      send_to: sendTo,
      ...parameters,
    });
    console.log('Google Ads: Conversion tracked', { eventName, send_to: sendTo, parameters });
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

  // Track in Google Analytics
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'form_submit_success', eventParameters);
    console.log('GA: Quote form submit success event tracked', { eventParameters });
  }

  // Track Google Ads conversion with the correct format
  if (typeof window !== 'undefined' && window.gtag && GOOGLE_ADS_CONVERSION_LABEL) {
    const sendTo = `${GOOGLE_ADS_ID}/${GOOGLE_ADS_CONVERSION_LABEL}`;
    window.gtag('event', 'conversion', {
      'send_to': sendTo,
      ...parameters,
    });
    console.log('Google Ads: Conversion tracked', { send_to: sendTo, parameters });
  }
};

// Track contact form submission success event for Google Ads and analytics
export const trackContactFormSubmitSuccess = (parameters?: Record<string, any>) => {
  const eventParameters = {
    event_category: 'form',
    event_label: 'contact_form',
    value: 0,
    currency: 'EUR',
    ...parameters,
  };

  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'contact_submit_success', eventParameters);
    console.log('GA: Contact form submit success event tracked', { eventParameters });
  }

  trackGoogleAdsConversion('contact_submit_success', eventParameters);
};

// Track user interactions
export const trackUserInteraction = (action: string, element: string) => {
  trackEvent(action, 'user_interaction', element);
};
