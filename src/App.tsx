import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AuthProvider from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import CustomersPage from './pages/dashboard/CustomersPage';
import PartnerManagement from './pages/PartnerManagement';
import OrderCalendarPage from './pages/OrderCalendarPage';
import OrderDetailsPage from './pages/OrderDetailsPage';
import RFQPage from './pages/RFQPage';
import QuoteRequestForm from './pages/QuoteRequestForm';
import Index from './pages/Index';
import Quote from './pages/Quote';
import Services from './pages/Services';
import Industries from './pages/Industries';
import About from './pages/About';
import Contact from './pages/Contact';
import SurfaceFinishes from './pages/SurfaceFinishes';
import SheetMetalFabrication from './pages/SheetMetalFabrication';
import InjectionMolding from './pages/InjectionMolding';
import CncMachining from './pages/CncMachining';
import ThreeDPrinting from './pages/3DPrinting';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import OrdersPage from './pages/dashboard/OrdersPage';
import RfqDetails from './pages/RfqDetails';
import RfqManagement from './pages/RfqManagement';
import ProductsPage from './pages/ProductsPage';
import QuoteSuccess from './pages/QuoteSuccess';
import RapidPrototyping from './pages/RapidPrototyping';
import CookieConsentBanner from './components/CookieConsentBanner';
import CookiePolicy from './pages/CookiePolicy';

// Import Dashboard/QuotesPage separately - DO NOT render this component directly in Routes
// It requires specific props that need to be passed when used
import QuotesPage from './pages/dashboard/QuotesPage';

function App() {
  console.log('App rendered');
  return (
    <HelmetProvider>
      <BrowserRouter>
        <ScrollToTop />
        <LanguageProvider>
          <AuthProvider>
            <Navbar />
            <Routes>
              {/* Root redirect - will be handled by LanguageProvider */}
              <Route path="/" element={<Index />} />
              
              {/* Language-specific routes */}
              <Route path="/:lang" element={<Index />} />
              <Route path="/:lang/login" element={<Login />} />
              <Route path="/:lang/quote" element={<Quote />} />
              <Route path="/:lang/quote/success" element={<QuoteSuccess />} />
              <Route path="/:lang/quote-request" element={<QuoteRequestForm />} />
              <Route path="/:lang/services" element={<Services />} />
              <Route path="/:lang/industries" element={<Industries />} />
              <Route path="/:lang/about" element={<About />} />
              <Route path="/:lang/contact" element={<Contact />} />
              
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
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              
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
              <Route path="/cookie-policy" element={<CookiePolicy />} />
            </Routes>
            <CookieConsentBanner />
            <Footer />
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </HelmetProvider>
  );
}

export default App;
