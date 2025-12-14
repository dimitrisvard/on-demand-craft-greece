import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, LogOut, ChevronDown, Cog, Square, Box, Layers } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import LanguageSwitcher from './LanguageSwitcher';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"

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

        <div className="hidden xl:flex items-center space-x-1 text-sm font-medium">
          <NavLink to={getLocalizedPath('/')} label={t('home_title', 'Home')} isActive={isRouteActive('/')} />
          <NavLink to="/dashboard" label="Dashboard" isActive={isRouteActive('/dashboard')} />
          
          {/* Mega Menu for Services */}
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger className="bg-transparent hover:bg-transparent text-sm font-medium text-brand-dark hover:text-brand-primary data-[state=open]:bg-transparent px-3 py-2 h-auto">
                  {t('navbar_services', 'Services')}
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px] bg-white">
                    <ListItem to={getLocalizedPath('/services/cnc-machining')} title="5-Axis Milling" icon={<Cog className="h-5 w-5 mb-1" />}>
                      High precision complex parts
                    </ListItem>
                    <ListItem to={getLocalizedPath('/services/cnc-turning')} title="Turning" icon={<Cog className="h-5 w-5 mb-1 rotate-90" />}>
                      Cylindrical parts & threads
                    </ListItem>
                    <ListItem to={getLocalizedPath('/services/sheet-metal')} title="Sheet Metal Bending" icon={<Square className="h-5 w-5 mb-1" />}>
                      Enclosures & brackets
                    </ListItem>
                    <ListItem to={getLocalizedPath('/services/3d-printing')} title="3D Printing" icon={<Layers className="h-5 w-5 mb-1" />}>
                      Rapid prototyping & complex geometries
                    </ListItem>
                    <div className="col-span-2 mt-2 pt-2 border-t text-center">
                      <Link to={getLocalizedPath('/services')} className="text-brand-primary hover:underline text-sm font-semibold">
                        View All Services →
                      </Link>
                    </div>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          <NavLink to={getLocalizedPath('/industries')} label={t('navbar_industries')} isActive={isRouteActive('/industries')} />
          <NavLink to={getLocalizedPath('/our-work')} label={t('navbar_our_work')} isActive={isRouteActive('/our-work')} />
          <NavLink to={getLocalizedPath('/blog')} label={t('navbar_blog', 'Blog')} isActive={isRouteActive('/blog')} />
          <NavLink to={getLocalizedPath('/about')} label={t('navbar_about')} isActive={isRouteActive('/about')} />
          <NavLink to={getLocalizedPath('/contact')} label={t('navbar_contact')} isActive={isRouteActive('/contact')} />
        </div>

        <div className="hidden xl:flex items-center space-x-4">
          <Link to={getLocalizedPath('/quote')}>
            <Button size="sm" variant="default" className="text-white bg-brand-accent hover:bg-brand-accent/90 px-4 font-bold shadow-sm">
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

        <button className="xl:hidden text-brand-dark" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <div className={`xl:hidden absolute top-full left-0 right-0 bg-white shadow-md transition-all duration-300 ${isOpen ? 'max-h-[500px] opacity-100 overflow-y-auto' : 'max-h-0 opacity-0 overflow-hidden'}`}>
        <div className="container-custom py-4 flex flex-col space-y-4">
          <MobileNavLink to={getLocalizedPath('/')} label={t('home_title', 'Home')} />
          <MobileNavLink to="/dashboard" label="Dashboard" />
          <div className="pl-4 border-l-2 border-gray-100 ml-2 space-y-2">
             <div className="font-medium text-brand-dark py-2">{t('navbar_services', 'Services')}</div>
             <MobileNavLink to={getLocalizedPath('/services/cnc-machining')} label="5-Axis Milling" />
             <MobileNavLink to={getLocalizedPath('/services/cnc-turning')} label="Turning" />
             <MobileNavLink to={getLocalizedPath('/services/sheet-metal')} label="Sheet Metal Bending" />
             <MobileNavLink to={getLocalizedPath('/services/3d-printing')} label="3D Printing" />
          </div>
          <MobileNavLink to={getLocalizedPath('/industries')} label={t('navbar_industries')} />
          <MobileNavLink to={getLocalizedPath('/our-work')} label={t('navbar_our_work')} />
          <MobileNavLink to={getLocalizedPath('/blog')} label={t('navbar_blog', 'Blog')} />
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
    className={`font-medium transition-colors duration-200 px-3 py-2 ${isActive ? 'text-brand-accent' : 'text-brand-dark hover:text-brand-primary'}`}
  >
    {label}
  </Link>
);

const MobileNavLink = ({ to, label }: { to: string, label: string }) => (
  <Link to={to} className="font-medium text-brand-dark hover:text-brand-primary py-2 block">
    {label}
  </Link>
);

const ListItem = ({ className, title, children, to, icon, ...props }: any) => {
  return (
    <li>
      <Link
        to={to}
        className={`block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-slate-100 focus:bg-slate-100 ${className}`}
        {...props}
      >
        <div className="flex items-center gap-3">
           <div className="text-brand-accent bg-brand-light/20 p-2 rounded-full">{icon}</div>
           <div>
            <div className="text-sm font-medium leading-none text-brand-dark">{title}</div>
            <p className="line-clamp-2 text-xs leading-snug text-gray-500 mt-1">
              {children}
            </p>
           </div>
        </div>
      </Link>
    </li>
  )
}

export default Navbar;
