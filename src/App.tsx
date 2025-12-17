import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePageTracking } from './hooks/usePageTracking';
import AuthProvider from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import CookieConsentBanner from './components/CookieConsentBanner';

// Lazy load pages to reduce initial bundle size
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Login = lazy(() => import('./pages/Login'));
const CustomersPage = lazy(() => import('./pages/dashboard/CustomersPage'));
const PartnerManagement = lazy(() => import('./pages/PartnerManagement'));
const OrderCalendarPage = lazy(() => import('./pages/OrderCalendarPage'));
const OrderDetailsPage = lazy(() => import('./pages/OrderDetailsPage'));
const RFQPage = lazy(() => import('./pages/RFQPage'));
const QuoteRequestForm = lazy(() => import('./pages/QuoteRequestForm'));
const Index = lazy(() => import('./pages/Index'));
const Quote = lazy(() => import('./pages/Quote'));
const Services = lazy(() => import('./pages/Services'));
const Industries = lazy(() => import('./pages/Industries'));
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));
const OurWork = lazy(() => import('./pages/OurWork'));
const SurfaceFinishes = lazy(() => import('./pages/SurfaceFinishes'));
const SheetMetalFabrication = lazy(() => import('./pages/SheetMetalFabrication'));
const InjectionMolding = lazy(() => import('./pages/InjectionMolding'));
const CncMachining = lazy(() => import('./pages/CncMachining'));
const ThreeDPrinting = lazy(() => import('./pages/3DPrinting'));
const OrdersPage = lazy(() => import('./pages/dashboard/OrdersPage'));
const RfqDetails = lazy(() => import('./pages/RfqDetails'));
const RfqManagement = lazy(() => import('./pages/RfqManagement'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const QuoteSuccess = lazy(() => import('./pages/QuoteSuccess'));
const ContactSuccess = lazy(() => import('./pages/ContactSuccess'));
const RapidPrototyping = lazy(() => import('./pages/RapidPrototyping'));
const TestPartnerNotification = lazy(() => import('./pages/TestPartnerNotification'));
const CookiePolicy = lazy(() => import('./pages/CookiePolicy'));
const ImpressumPage = lazy(() => import('./pages/ImpressumPage'));
const AnalyticsPage = lazy(() => import('./pages/dashboard/AnalyticsPage'));
const BlogList = lazy(() => import('./pages/dashboard/BlogList'));
const BlogEditor = lazy(() => import('./pages/dashboard/BlogEditor'));
const BlogIndex = lazy(() => import('./pages/BlogIndex'));
const BlogPost = lazy(() => import('./pages/BlogPost'));
const EmailMarketing = lazy(() => import('./pages/dashboard/EmailMarketing'));
const EmailInbox = lazy(() => import('./pages/dashboard/EmailInbox'));
const QuotesPage = lazy(() => import('./pages/dashboard/QuotesPage'));

// Loading component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
  </div>
);

const queryClient = new QueryClient();

// Component to handle Google Analytics tracking
function AppContent() {
  usePageTracking(); // This hook must be used inside BrowserRouter
  
  return (
    <>
      <ScrollToTop />
      <LanguageProvider>
        <AuthProvider>
            <Navbar />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Root redirect - will be handled by LanguageProvider */}
                <Route path="/" element={<Index />} />
                
                {/* Language-specific routes */}
                <Route path="/:lang" element={<Index />} />
                <Route path="/:lang/blog" element={<BlogIndex />} />
                <Route path="/:lang/blog/:slug" element={<BlogPost />} />
                <Route path="/:lang/login" element={<Login />} />
                <Route path="/:lang/quote" element={<Quote />} />
                <Route path="/:lang/quote/success" element={<QuoteSuccess />} />
                <Route path="/:lang/quote-request" element={<QuoteRequestForm />} />
                <Route path="/:lang/services" element={<Services />} />
                <Route path="/:lang/industries" element={<Industries />} />
                <Route path="/:lang/our-work" element={<OurWork />} />
                <Route path="/:lang/about" element={<About />} />
                <Route path="/:lang/contact" element={<Contact />} />
                <Route path="/:lang/contact/success" element={<ContactSuccess />} />
                
                <Route path="/:lang/services/surface-finishes" element={<SurfaceFinishes />} />
                <Route path="/:lang/services/sheet-metal" element={<SheetMetalFabrication />} />
                <Route path="/:lang/services/cnc-machining" element={<CncMachining />} />
                <Route path="/:lang/services/3d-printing" element={<ThreeDPrinting />} />
                <Route path="/:lang/services/injection-molding" element={<InjectionMolding />} />
                <Route path="/:lang/services/rapid-prototyping" element={<RapidPrototyping />} />

                {/* Legacy routes (without language prefix) - for backward compatibility */}
                <Route path="/login" element={<Login />} />
                <Route path="/quote" element={<Quote />} />
                <Route path="/quote/success" element={<QuoteSuccess />} />
                <Route path="/quote-request" element={<QuoteRequestForm />} />
                <Route path="/services" element={<Services />} />
                <Route path="/industries" element={<Industries />} />
                <Route path="/our-work" element={<OurWork />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/contact/success" element={<ContactSuccess />} />
                
                <Route path="/services/surface-finishes" element={<SurfaceFinishes />} />
                <Route path="/services/sheet-metal" element={<SheetMetalFabrication />} />
                <Route path="/services/cnc-machining" element={<CncMachining />} />
                <Route path="/services/3d-printing" element={<ThreeDPrinting />} />
                <Route path="/services/injection-molding" element={<InjectionMolding />} />
                <Route path="/services/rapid-prototyping" element={<RapidPrototyping />} />

                {/* Dashboard routes (language-agnostic) */}
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/partners" element={<PartnerManagement />} />
                <Route path="/calendar" element={<OrderCalendarPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/rfq" element={<RFQPage />} />
                <Route path="/rfq/:id" element={<RfqDetails />} />
                <Route path="/rfq-details/:id" element={<RfqDetails />} />
                <Route path="/rfq-management" element={<RfqManagement />} />
                <Route path="/orders/:id" element={<OrderDetailsPage />} />
                
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/dashboard/orders" element={<OrdersPage />} />
                <Route path="/dashboard/customers" element={<CustomersPage />} />
                <Route path="/dashboard/quotes" element={<QuotesPage />} />
                <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
                <Route path="/dashboard/blog" element={<BlogList />} />
                <Route path="/dashboard/blog/new" element={<BlogEditor />} />
                <Route path="/dashboard/blog/edit/:id" element={<BlogEditor />} />
                <Route path="/dashboard/email-inbox" element={<EmailInbox />} />
                <Route path="/dashboard/email-marketing" element={<EmailMarketing />} />
                <Route path="/dashboard/email-marketing/*" element={<EmailMarketing />} />
                <Route path="/test-partner-notification" element={<TestPartnerNotification />} />
                <Route path="/cookie-policy" element={<CookiePolicy />} />
                <Route path="/impressum" element={<ImpressumPage />} />
                <Route path="/:lang/impressum" element={<ImpressumPage />} />
              </Routes>
            </Suspense>
          <CookieConsentBanner />
          <Footer />
        </AuthProvider>
      </LanguageProvider>
    </>
  );
}

function App() {
  console.log('App rendered');
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;
