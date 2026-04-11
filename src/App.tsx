import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePageTracking } from './hooks/usePageTracking';
import AuthProvider from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { TenantProvider, useTenant as useTenantCtx } from './contexts/TenantContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import CookieConsentBanner from './components/CookieConsentBanner';
import TranslatedRouteMatcher from './components/TranslatedRouteMatcher';
import SEORedirects from './components/SEORedirects';
import CustomerPortalLayout from './components/customer-portal/CustomerPortalLayout';
import PartnerPortalLayout from './components/partner-portal/PartnerPortalLayout';
import { hasCustomPage } from './pages/tenants/customPageRegistry';

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
const CookiePolicy = lazy(() => import('./pages/CookiePolicy'));
const ImpressumPage = lazy(() => import('./pages/ImpressumPage'));
const AnalyticsPage = lazy(() => import('./pages/dashboard/AnalyticsPage'));
const BlogList = lazy(() => import('./pages/dashboard/BlogList'));
const BlogEditor = lazy(() => import('./pages/dashboard/BlogEditor'));
const BlogIndex = lazy(() => import('./pages/BlogIndex'));
const BlogPost = lazy(() => import('./pages/BlogPost'));
const EmailMarketing = lazy(() => import('./pages/dashboard/EmailMarketing'));
const EmailInbox = lazy(() => import('./pages/dashboard/EmailInbox'));
const NotificationsPage = lazy(() => import('./pages/dashboard/NotificationsPage'));
const SettingsPage = lazy(() => import('./pages/dashboard/SettingsPage'));
const QuotesPage = lazy(() => import('./pages/dashboard/QuotesPage'));
const AutoBlogDashboard = lazy(() => import('./pages/dashboard/AutoBlogDashboard'));
const LeadMonitorPage = lazy(() => import('./pages/dashboard/LeadMonitorPage'));
const SeoConsolePage = lazy(() => import('./pages/dashboard/SeoConsolePage'));
const CompanyScannerPage = lazy(() => import('./pages/dashboard/CompanyScannerPage'));
const TenderMonitorPage = lazy(() => import('./pages/dashboard/TenderMonitorPage'));
const FundedStartupsPage = lazy(() => import('./pages/dashboard/FundedStartupsPage'));
const Education = lazy(() => import('./pages/Education'));

// Inventory Management Pages
const InventoryDashboard = lazy(() => import('./pages/inventory/InventoryDashboard'));
const StockReceive = lazy(() => import('./pages/inventory/StockReceive'));
const NestingSessionManager = lazy(() => import('./pages/inventory/NestingSessionManager'));
const QRScanner = lazy(() => import('./pages/inventory/QRScanner'));
const InventoryAlerts = lazy(() => import('./pages/inventory/InventoryAlerts'));
const InventorySettingsPage = lazy(() => import('./pages/inventory/InventorySettingsPage'));

// Material Catalog Pages
const MaterialCatalogPage = lazy(() => import('./pages/catalog/MaterialCatalogPage'));
const MaterialAdminPage = lazy(() => import('./pages/catalog/MaterialAdminPage'));

// Customer Portal Pages
const CustomerDashboard = lazy(() => import('./pages/customer/CustomerDashboard'));
const MyProjectsPage = lazy(() => import('./pages/customer/MyProjectsPage'));
const QuoteDetailPage = lazy(() => import('./pages/customer/QuoteDetailPage'));

const MyFinancePage = lazy(() => import('./pages/customer/MyFinancePage'));
const PartConfigurationPage = lazy(() => import('./pages/customer/PartConfigurationPage'));
const CheckoutPage = lazy(() => import('./pages/customer/CheckoutPage'));
const CustomerQuotePage = lazy(() => import('./pages/customer/CustomerQuotePage'));

// Partner Portal Pages
const PartnerJobBoard = lazy(() => import('./pages/partner/PartnerJobBoard'));
const PartnerFinancePage = lazy(() => import('./pages/partner/PartnerFinancePage'));
const PartnerOrderDetailPage = lazy(() => import('./pages/partner/PartnerOrderDetailPage'));
const PartnerOrdersPage = lazy(() => import('./pages/partner/PartnerOrdersPage'));

// Multi-Tenant Admin Pages
const TenantsListPage = lazy(() => import('./pages/dashboard/tenants/TenantsListPage'));
const TenantEditPage = lazy(() => import('./pages/dashboard/tenants/TenantEditPage'));

// Loading component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
  </div>
);

const queryClient = new QueryClient();

// Component to conditionally render Navbar (hide when tenant has custom page)
function ConditionalNavbar() {
  const { tenant, isTenantSubdomain, isCustomDomain } = useTenantCtx();
  if ((isTenantSubdomain || isCustomDomain) && hasCustomPage(tenant?.slug)) {
    return null;
  }
  return <Navbar />;
}

// Component to conditionally render Footer (exclude dashboard routes + custom tenant pages)
function ConditionalFooter() {
  const location = useLocation();
  const path = location.pathname;
  const { tenant, isTenantSubdomain, isCustomDomain } = useTenantCtx();

  // Don't show footer when tenant has a custom page (it ships its own footer)
  if ((isTenantSubdomain || isCustomDomain) && hasCustomPage(tenant?.slug)) {
    return null;
  }

  // Don't show footer on dashboard routes
  const isDashboardRoute = path.startsWith('/dashboard') ||
                          path.startsWith('/orders') ||
                          path.startsWith('/customers') ||
                          path.startsWith('/partners') ||
                          path.startsWith('/calendar') ||
                          path.startsWith('/products') ||
                          path.startsWith('/rfq') ||
                          path.startsWith('/customer') ||
                          path.startsWith('/partner') ||
                          path.startsWith('/dashboard/inventory');

  if (isDashboardRoute) {
    return null;
  }

  return <Footer />;
}

// Component to handle Google Analytics tracking
function AppContent() {
  usePageTracking(); // This hook must be used inside BrowserRouter
  
  return (
    <>
      <ScrollToTop />
      <SEORedirects />
      <TenantProvider>
      <LanguageProvider>
        <AuthProvider>
            <ConditionalNavbar />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Root redirect - will be handled by LanguageProvider */}
                <Route path="/" element={<Index />} />
                
                {/* Language-specific routes */}
                <Route path="/:lang" element={<Index />} />
                
                {/* Blog routes - support both English and translated blog slugs */}
                {/* English blog */}
                <Route path="/:lang/blog" element={<BlogIndex />} />
                <Route path="/:lang/blog/:slug" element={<BlogPost />} />
                {/* Swedish/Norwegian blog (blogg) */}
                <Route path="/:lang/blogg" element={<BlogIndex />} />
                <Route path="/:lang/blogg/:slug" element={<BlogPost />} />
                {/* Finnish blog (blogi) */}
                <Route path="/:lang/blogi" element={<BlogIndex />} />
                <Route path="/:lang/blogi/:slug" element={<BlogPost />} />
                
                {/* Static routes - support both English and translated slugs */}
                <Route path="/:lang/login" element={<Login />} />
                
                {/* Quote routes */}
                <Route path="/:lang/quote" element={<Quote />} />
                <Route path="/:lang/quote/success" element={<QuoteSuccess />} />
                <Route path="/:lang/quote-request" element={<QuoteRequestForm />} />
                
                {/* Keep English routes FIRST for exact matching (better performance and SEO) */}
                <Route path="/:lang/services" element={<Services />} />
                <Route path="/:lang/industries" element={<Industries />} />
                <Route path="/:lang/our-work" element={<OurWork />} />
                <Route path="/:lang/about" element={<About />} />
                <Route path="/:lang/contact" element={<Contact />} />
                <Route path="/:lang/contact/success" element={<ContactSuccess />} />
                <Route path="/:lang/education" element={<Education />} />
                
                <Route path="/:lang/services/surface-finishes" element={<SurfaceFinishes />} />
                <Route path="/:lang/services/sheet-metal" element={<SheetMetalFabrication />} />
                <Route path="/:lang/services/cnc-machining" element={<CncMachining />} />
                <Route path="/:lang/services/3d-printing" element={<ThreeDPrinting />} />
                <Route path="/:lang/services/injection-molding" element={<InjectionMolding />} />
                <Route path="/:lang/services/rapid-prototyping" element={<RapidPrototyping />} />
                
                {/* Catch-all routes for translated URLs - placed AFTER specific English routes */}
                {/* These will match translated slugs like /de/dienstleistungen and reverse-translate them */}
                <Route path="/:lang/:slug/:subslug" element={<TranslatedRouteMatcher />} />
                <Route path="/:lang/:slug" element={<TranslatedRouteMatcher />} />

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
                <Route path="/education" element={<Education />} />
                
                <Route path="/services/surface-finishes" element={<SurfaceFinishes />} />
                <Route path="/services/sheet-metal" element={<SheetMetalFabrication />} />
                <Route path="/services/cnc-machining" element={<CncMachining />} />
                <Route path="/services/3d-printing" element={<ThreeDPrinting />} />
                <Route path="/services/injection-molding" element={<InjectionMolding />} />
                <Route path="/services/rapid-prototyping" element={<RapidPrototyping />} />

                {/* Customer Portal routes */}
                <Route path="/customer/dashboard" element={<CustomerPortalLayout><CustomerDashboard /></CustomerPortalLayout>} />
                <Route path="/customer/projects" element={<CustomerPortalLayout><MyProjectsPage /></CustomerPortalLayout>} />
                <Route path="/customer/quotes/:id" element={<CustomerPortalLayout><QuoteDetailPage /></CustomerPortalLayout>} />
                <Route path="/customer/quotes/:quoteId/parts/:partIndex" element={<CustomerPortalLayout><PartConfigurationPage /></CustomerPortalLayout>} />

                <Route path="/customer/finance" element={<CustomerPortalLayout><MyFinancePage /></CustomerPortalLayout>} />
                <Route path="/customer/quote" element={<CustomerPortalLayout><CustomerQuotePage /></CustomerPortalLayout>} />
                <Route path="/customer/order" element={<CustomerPortalLayout><CustomerQuotePage /></CustomerPortalLayout>} />
                <Route path="/customer/checkout/:id" element={<CustomerPortalLayout><CheckoutPage /></CustomerPortalLayout>} />

                {/* Partner Portal routes */}
                <Route path="/partner/jobs" element={<PartnerPortalLayout><PartnerJobBoard /></PartnerPortalLayout>} />
                <Route path="/partner/orders" element={<PartnerPortalLayout><PartnerOrdersPage /></PartnerPortalLayout>} />
                <Route path="/partner/orders/:id" element={<PartnerPortalLayout><PartnerOrderDetailPage /></PartnerPortalLayout>} />
                <Route path="/partner/finance" element={<PartnerPortalLayout><PartnerFinancePage /></PartnerPortalLayout>} />

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
                
                <Route path="/orders" element={<RfqManagement />} />
                <Route path="/dashboard/orders" element={<RfqManagement />} />
                <Route path="/dashboard/customers" element={<CustomersPage />} />
                <Route path="/dashboard/quotes" element={<RfqManagement />} />
                <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
                <Route path="/dashboard/blog" element={<BlogList />} />
                <Route path="/dashboard/blog/new" element={<BlogEditor />} />
                <Route path="/dashboard/blog/edit/:id" element={<BlogEditor />} />
                <Route path="/dashboard/auto-blog" element={<AutoBlogDashboard />} />
                <Route path="/dashboard/email-inbox" element={<EmailInbox />} />
                <Route path="/dashboard/email-marketing" element={<EmailMarketing />} />
                <Route path="/dashboard/email-marketing/*" element={<EmailMarketing />} />
                <Route path="/dashboard/notifications" element={<NotificationsPage />} />
                <Route path="/dashboard/settings" element={<SettingsPage />} />
                <Route path="/dashboard/leads" element={<LeadMonitorPage />} />
                <Route path="/dashboard/seo" element={<SeoConsolePage />} />
                <Route path="/dashboard/company-scanner" element={<CompanyScannerPage />} />
                <Route path="/dashboard/tenders" element={<TenderMonitorPage />} />
                <Route path="/dashboard/funded-startups" element={<FundedStartupsPage />} />

                {/* Material Catalog */}
                <Route path="/dashboard/materials" element={<MaterialCatalogPage />} />
                <Route path="/dashboard/materials/admin" element={<MaterialAdminPage />} />
                <Route path="/dashboard/materials/:categorySlug" element={<MaterialCatalogPage />} />

                {/* Inventory Management */}
                <Route path="/dashboard/inventory" element={<InventoryDashboard />} />
                <Route path="/dashboard/inventory/receive" element={<StockReceive />} />
                <Route path="/dashboard/inventory/sessions" element={<NestingSessionManager />} />
                <Route path="/dashboard/inventory/scan" element={<QRScanner />} />
                <Route path="/dashboard/inventory/scan/:qrCode" element={<QRScanner />} />
                <Route path="/dashboard/inventory/alerts" element={<InventoryAlerts />} />
                <Route path="/dashboard/inventory/settings" element={<InventorySettingsPage />} />

                {/* Multi-Tenant Management */}
                <Route path="/dashboard/tenants" element={<TenantsListPage />} />
                <Route path="/dashboard/tenants/:id" element={<TenantEditPage />} />

                <Route path="/cookie-policy" element={<CookiePolicy />} />
                {/* Legacy impressum route without language prefix - for backward compatibility */}
                <Route path="/impressum" element={<ImpressumPage />} />
                {/* Translated impressum routes are handled by TranslatedRouteMatcher above */}
              </Routes>
            </Suspense>
          <CookieConsentBanner />
          <ConditionalFooter />
        </AuthProvider>
      </LanguageProvider>
      </TenantProvider>
    </>
  );
}

function App() {
  console.log('App rendered');
  
  // Suppress harmless postMessage errors from embedded iframes (YouTube, Google Maps, etc.)
  // These errors occur when iframes try to communicate but origin checks fail
  React.useEffect(() => {
    // Override console.error to filter out postMessage origin mismatch errors
    const originalError = console.error;
    console.error = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      // Suppress postMessage origin mismatch errors from embedded content
      if (message.includes('postMessage') && 
          (message.includes('google.com') || 
           message.includes('youtube.com') ||
           message.includes('DOMWindow'))) {
        // Suppress this harmless error - it's from third-party iframes
        return;
      }
      // Log all other errors normally
      originalError.apply(console, args);
    };

    return () => {
      console.error = originalError;
    };
  }, []);

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
