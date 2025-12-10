import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView, initGA } from '../utils/analytics';

// Hook to track page views in React Router
export const usePageTracking = () => {
  const location = useLocation();

  useEffect(() => {
    // Initialize GA on first load
    initGA();
  }, []);

  useEffect(() => {
    // Track page view on route change
    const url = window.location.origin + location.pathname + location.search;
    const title = document.title;
    
    // Wait for gtag to be available (with retry mechanism)
    const trackWithRetry = (attempts = 0) => {
      if (typeof window !== 'undefined' && (window as any).gtag) {
        // gtag is available, track immediately
        trackPageView(url, title);
      } else if (attempts < 10) {
        // Retry after a short delay (max 10 attempts = ~2 seconds)
        setTimeout(() => trackWithRetry(attempts + 1), 200);
      } else {
        console.warn('Google Analytics gtag not available after retries');
      }
    };
    
    // Small delay to ensure the page title is updated by the component
    const timer = setTimeout(() => {
      trackWithRetry();
    }, 100);

    return () => clearTimeout(timer);
  }, [location]);
};
