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
    
    // Small delay to ensure the page title is updated by the component
    const timer = setTimeout(() => {
      trackPageView(url, title);
    }, 100);

    return () => clearTimeout(timer);
  }, [location]);
};
