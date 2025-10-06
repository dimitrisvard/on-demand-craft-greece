import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, LogOut, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import LanguageSwitcher from './LanguageSwitcher';

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const { getLocalizedPath, getPathWithoutLanguage } = useLanguage();

  useEffect(() => {
    setIsOpen(false);
  }, [location]);

  // Helper function to check if a route is active
  const isRouteActive = (routePath: string) => {
    const currentPath = location.pathname;
    
    // Remove language prefix for comparison using the context function
    const pathWithoutLang = getPathWithoutLanguage(currentPath);
    
    // Handle root path specially
    if (routePath === '/') {
      return pathWithoutLang === '/' || pathWithoutLang === '';
    }
    
    // Check if the route matches
    return pathWithoutLang === routePath || pathWithoutLang.startsWith(routePath);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white shadow-md py-3">
      <div className="container-custom flex justify-between items-center">
        <Link to={getLocalizedPath('/')} className="flex items-center">
          <img 
            src="/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png" 
            alt="Microns Hub Logo" 
            className="h-10"
          />
        </Link>

        <div className="hidden md:flex space-x-8">
          <NavLink to={getLocalizedPath('/')} label={t('home_title', 'Home')} isActive={isRouteActive('/')} />
          <NavLink to="/dashboard" label="Dashboard" isActive={isRouteActive('/dashboard')} />
          <NavLink to={getLocalizedPath('/services')} label={t('navbar_services')} isActive={isRouteActive('/services')} />
          <NavLink to={getLocalizedPath('/industries')} label={t('navbar_industries')} isActive={isRouteActive('/industries')} />
          <NavLink to={getLocalizedPath('/our-work')} label={t('navbar_our_work')} isActive={isRouteActive('/our-work')} />
          <NavLink to={getLocalizedPath('/about')} label={t('navbar_about')} isActive={isRouteActive('/about')} />
          <NavLink to={getLocalizedPath('/contact')} label={t('navbar_contact')} isActive={isRouteActive('/contact')} />
        </div>

        <div className="hidden md:flex items-center space-x-4">
          <Link to={getLocalizedPath('/quote')}>
            <Button size="sm" variant="default" className="text-white bg-brand-accent hover:bg-brand-accent/90 px-2">
              {t('navbar_get_quote')}
            </Button>
          </Link>
          {user && (
            <Button 
              variant="ghost" 
              onClick={signOut}
              className="flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          )}
          <LanguageSwitcher />
        </div>

        <button className="md:hidden text-brand-dark" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <div className={`md:hidden absolute top-full left-0 right-0 bg-white shadow-md transition-all duration-300 ${isOpen ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
        <div className="container-custom py-4 flex flex-col space-y-4">
          <MobileNavLink to={getLocalizedPath('/')} label={t('home_title', 'Home')} />
          <MobileNavLink to="/dashboard" label="Dashboard" />
          <MobileNavLink to={getLocalizedPath('/services')} label={t('navbar_services')} />
          <MobileNavLink to={getLocalizedPath('/industries')} label={t('navbar_industries')} />
          <MobileNavLink to={getLocalizedPath('/our-work')} label={t('navbar_our_work')} />
          <MobileNavLink to={getLocalizedPath('/about')} label={t('navbar_about')} />
          <MobileNavLink to={getLocalizedPath('/contact')} label={t('navbar_contact')} />
          <Link to={getLocalizedPath('/quote')} className="btn-primary text-center">{t('navbar_get_quote')}</Link>
          {user && (
            <Button 
              variant="ghost" 
              onClick={signOut}
              className="flex items-center justify-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          )}
          <div className="flex justify-center">
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </nav>
  );
};

const NavLink = ({ to, label, isActive }: { to: string, label: string, isActive: boolean }) => (
  <Link 
    to={to} 
    className={`font-medium transition-colors duration-200 ${isActive ? 'text-brand-accent' : 'text-brand-dark hover:text-brand-primary'}`}
  >
    {label}
  </Link>
);

const MobileNavLink = ({ to, label }: { to: string, label: string }) => (
  <Link to={to} className="font-medium text-brand-dark hover:text-brand-primary py-2 block">
    {label}
  </Link>
);

export default Navbar;
